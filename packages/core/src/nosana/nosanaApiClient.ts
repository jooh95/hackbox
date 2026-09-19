import crypto from "node:crypto";
import { config } from "../config.js";
import { buildLoadGeneratorScript } from "./loadGeneratorScript.js";
import type { LoadTestClient, RunLoadTestParams } from "./types.js";
import type { LoadResult } from "../types.js";

const API_BASE = "https://api.nosana.com";

// The cheapest PREMIUM GPU market, used as the default because Nosana has no
// CPU-only market and credit-paid (API key) jobs are only allowed on premium
// markets — community markets reject credit payment outright. Our load
// generator doesn't touch the GPU; it just pays this market's per-second rate.
const DEFAULT_MARKET = "7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq"; // nvidia-3060 (premium)

interface DeploymentStatus {
  id: string;
  status: "DRAFT" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "INSUFFICIENT_FUNDS" | "ERROR" | "ARCHIVED";
  [key: string]: unknown;
}

async function nosanaFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.nosana.walletPrivateKey()}`,
      ...init.headers,
    },
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Nosana API ${init.method ?? "GET"} ${path} failed (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Deploys the load generator as a real Nosana job via Nosana's hosted REST
 * API (api.nosana.com), authenticated with a Nosana API key that spends the
 * account's Nosana Credits. This is the path used when
 * NOSANA_WALLET_PRIVATE_KEY holds an API key (starts with "nos_") rather
 * than a raw Solana wallet keypair — Nosana's own dashboard
 * (deploy.nosana.com) issues keys in this form, and it avoids having to
 * locally manage a funded Solana wallet at all.
 */
export class NosanaApiLoadTestClient implements LoadTestClient {
  readonly engine = "nosana-api";

  async runLoadTest(params: RunLoadTestParams): Promise<Omit<LoadResult, "samples">> {
    const { runId, targetBaseUrl, callbackUrl, targetRps, rampUpSeconds, holdSeconds, rampDownSeconds, killSwitch, callbackEvents, onSample, onProgress, onAbort } = params;
    const startedAt = new Date().toISOString();
    const market = config.nosana.market() || DEFAULT_MARKET;
    const totalSeconds = rampUpSeconds + holdSeconds + rampDownSeconds;
    // Credit-paid Nosana deployments require a minimum 3600s (60 minute)
    // timeout regardless of how long the job actually runs — this is a cap,
    // not a fixed charge, since we stop the deployment ourselves (see below)
    // the moment the script finishes or the kill switch fires.
    const totalMinutes = Math.max(60, Math.ceil(totalSeconds / 60) + 2);

    const scriptB64 = Buffer.from(buildLoadGeneratorScript(), "utf8").toString("base64");
    const deploymentBody = {
      name: `hackbox-${runId}`.slice(0, 64),
      market,
      replicas: 1,
      timeout: totalMinutes,
      strategy: "SIMPLE",
      new_vault: true,
      autostart: true,
      // The API defaults this to true (requiring a rare confidential-computing
      // TEE worker) if omitted, which can leave a job unpicked indefinitely on
      // markets with no such nodes. This load generator has no confidentiality
      // requirement, so ask for a normal worker explicitly.
      confidential: false,
      job_definition: {
        version: "0.1",
        type: "container",
        ops: [
          {
            type: "container/run",
            id: "hackbox-load-generator",
            args: {
              image: "node:20-alpine",
              entrypoint: ["/bin/sh", "-c"],
              cmd: [`echo ${scriptB64} | base64 -d > /tmp/run.mjs && node /tmp/run.mjs`],
              env: {
                TARGET_URL: targetBaseUrl,
                CALLBACK_URL: callbackUrl,
                TARGET_RPS: String(targetRps),
                RAMP_UP_SECONDS: String(rampUpSeconds),
                HOLD_SECONDS: String(holdSeconds),
                RAMP_DOWN_SECONDS: String(rampDownSeconds),
              },
            },
          },
        ],
      },
    };

    onProgress(`Creating Nosana deployment on market ${market} via api.nosana.com...`);
    const deployment = (await nosanaFetch("/deployments/create", {
      method: "POST",
      body: JSON.stringify(deploymentBody),
    })) as DeploymentStatus;
    const deploymentId = deployment.id;
    onProgress(`Nosana deployment created: ${deploymentId} (status: ${deployment.status}). Waiting for a worker node...`);

    let aborted = false;
    let peakRps = 0;
    const errorRates: number[] = [];
    const p95s: number[] = [];
    let finalPayload: any = null;

    const stopDeployment = async (reason: string) => {
      onProgress(`Stopping Nosana deployment ${deploymentId}: ${reason}`);
      await nosanaFetch(`/deployments/${deploymentId}/stop`, { method: "POST" }).catch((err) =>
        onProgress(`Warning: failed to stop Nosana deployment cleanly: ${(err as Error).message}`)
      );
    };

    const onCallback = (event: any) => {
      if (event.type === "sample") {
        peakRps = Math.max(peakRps, event.rps);
        errorRates.push(event.errorRate);
        p95s.push(event.p95LatencyMs);
        onSample({ ts: event.ts, rps: event.rps, errorRate: event.errorRate, p95LatencyMs: event.p95LatencyMs });
        const decision = killSwitch.evaluate({ errorRate: event.errorRate, p95LatencyMs: event.p95LatencyMs });
        if (decision.shouldAbort && !aborted) {
          aborted = true;
          onAbort(decision.reason ?? "kill switch triggered");
          void stopDeployment(decision.reason ?? "kill switch triggered");
        }
      } else if (event.type === "final") {
        finalPayload = event;
      }
    };
    callbackEvents.on("callback", onCallback);

    // How long we're willing to wait for a worker to pick up and finish the
    // job — independent of the deployment's own (much longer) billing-cap
    // timeout above. A generous multiple of the planned test duration, with a
    // floor to cover real-world queueing delay for a scarce community market.
    const ourPatienceMs = Math.max(10 * 60_000, totalSeconds * 1000 * 6);
    const deadline = Date.now() + ourPatienceMs;
    let finished = false;
    let selfStopped = false;
    let lastStatus = deployment.status;
    while (!finished && !aborted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));

      // The script's own "final" callback is the fastest, most authoritative
      // completion signal — it arrives the moment the container's work is
      // done, well before the deployment's own status catches up (which can
      // lag by a minute or more). Treat it as done and stop the deployment
      // ourselves rather than waiting on that lag.
      if (finalPayload && !selfStopped) {
        finished = true;
        selfStopped = true;
        await stopDeployment("load generator finished");
        break;
      }

      const status = await nosanaFetch(`/deployments/${deploymentId}`).catch(() => null);
      if (!status) continue;
      if (status.status !== lastStatus) {
        lastStatus = status.status;
        onProgress(`Nosana deployment status: ${lastStatus}`);
      }
      if (status.status === "INSUFFICIENT_FUNDS") {
        throw new Error("Nosana deployment failed: insufficient credits/funds on this account.");
      }
      if (status.status === "ERROR") {
        throw new Error("Nosana deployment entered an ERROR state.");
      }
      if (["STOPPED", "ARCHIVED"].includes(status.status)) {
        finished = true;
      }
    }
    callbackEvents.off("callback", onCallback);

    if (!finished && !aborted) {
      onProgress("Timed out waiting for the Nosana deployment to finish; stopping it.");
      await stopDeployment("submission timeout");
    }
    // Otherwise the deployment was already stopped above (either by us, on
    // the "final" signal, or because it reached STOPPED/ARCHIVED on its own).

    const sortedP95 = [...p95s].sort((a, b) => a - b);
    const pct = (p: number) => (sortedP95.length ? sortedP95[Math.min(sortedP95.length - 1, Math.ceil((p / 100) * sortedP95.length) - 1)] : 0);

    return {
      id: `load_${crypto.randomUUID()}`,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      targetRps,
      peakRps: finalPayload?.peakRps ?? peakRps,
      overallErrorRate: finalPayload?.overallErrorRate ?? (errorRates.length ? errorRates.reduce((a, b) => a + b, 0) / errorRates.length : 0),
      p50LatencyMs: finalPayload?.p50LatencyMs ?? pct(50),
      p95LatencyMs: finalPayload?.p95LatencyMs ?? pct(95),
      p99LatencyMs: finalPayload?.p99LatencyMs ?? pct(99),
      killSwitchTriggered: aborted,
      rawSummaryPath: null,
    };
  }
}
