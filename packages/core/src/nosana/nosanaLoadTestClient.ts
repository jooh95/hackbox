import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { buildLoadGeneratorScript } from "./loadGeneratorScript.js";
import type { LoadTestClient, RunLoadTestParams } from "./types.js";
import type { LoadResult } from "../types.js";

function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("nosana", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`nosana CLI timed out: nosana ${args.join(" ")}`));
    }, timeoutMs);
    proc.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    proc.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

function resolveWalletPath(): string {
  const raw = config.nosana.walletPrivateKey();
  if (!raw) throw new Error("NOSANA_WALLET_PRIVATE_KEY is not configured");
  if (fs.existsSync(raw)) return raw; // already a path to a keypair file
  const walletDir = path.join(config.dataDir, "secrets");
  fs.mkdirSync(walletDir, { recursive: true, mode: 0o700 });
  const walletPath = path.join(walletDir, "nosana_wallet.json");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      fs.writeFileSync(walletPath, JSON.stringify(parsed), { mode: 0o600 });
      return walletPath;
    }
  } catch {
    // fall through — not JSON, treat as an opaque secret-key string below
  }
  throw new Error(
    "NOSANA_WALLET_PRIVATE_KEY must be either a path to an existing Solana keypair JSON file, or the JSON array contents of one (e.g. from ~/.nosana/nosana_key.json)."
  );
}

/**
 * Deploys the load generator as a real Nosana job (per docs/04-nosana-load-testing.md)
 * by shelling out to the official `nosana` CLI rather than the low-level
 * on-chain SDK — the CLI already handles IPFS pinning, market selection, and
 * on-chain job listing correctly, which would otherwise be easy to get subtly
 * wrong by hand. Requires a funded Solana wallet (SOL for fees, NOS for the
 * job price) and a chosen market.
 */
export class NosanaLoadTestClient implements LoadTestClient {
  readonly engine = "nosana-job";

  async runLoadTest(params: RunLoadTestParams): Promise<Omit<LoadResult, "samples">> {
    const { runId, targetBaseUrl, callbackUrl, targetRps, rampUpSeconds, holdSeconds, rampDownSeconds, killSwitch, callbackEvents, onSample, onProgress, onAbort } = params;
    const startedAt = new Date().toISOString();
    const walletPath = resolveWalletPath();
    const network = config.nosana.network();
    const market = config.nosana.market();
    if (!market) throw new Error("NOSANA_MARKET is not configured (market slug or address to post the job to)");

    const scriptB64 = Buffer.from(buildLoadGeneratorScript(), "utf8").toString("base64");
    const flow = {
      version: "0.1",
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
    };
    const flowPath = path.join(os.tmpdir(), `hackbox-nosana-flow-${runId}.json`);
    fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));

    const totalMinutes = Math.max(1, Math.ceil((rampUpSeconds + holdSeconds + rampDownSeconds) / 60) + 2);
    onProgress(`Posting Nosana job to market "${market}" on ${network}...`);
    const postResult = await runCli(
      ["job", "post", "--file", flowPath, "--market", market, "--wallet", walletPath, "--network", network, "--timeout", String(totalMinutes), "--format", "json"],
      120_000
    );
    if (postResult.code !== 0) {
      throw new Error(`nosana job post failed (exit ${postResult.code}): ${postResult.stderr || postResult.stdout}`);
    }
    let jobAddress: string;
    try {
      const parsed = JSON.parse(postResult.stdout);
      jobAddress = parsed.job ?? parsed.jobAddress ?? parsed.address;
      if (!jobAddress) throw new Error("no job address in response");
    } catch (err) {
      throw new Error(`Could not parse Nosana job address from CLI output: ${postResult.stdout} (${(err as Error).message})`);
    }
    onProgress(`Nosana job posted: ${jobAddress}. Waiting for a worker to pick it up...`);

    let aborted = false;
    let peakRps = 0;
    const errorRates: number[] = [];
    const p95s: number[] = [];
    let finalPayload: any = null;

    const stopJob = async (reason: string) => {
      onProgress(`Stopping Nosana job ${jobAddress}: ${reason}`);
      await runCli(["job", "stop", jobAddress, "--wallet", walletPath, "--network", network], 60_000).catch((err) =>
        onProgress(`Warning: failed to stop Nosana job cleanly: ${(err as Error).message}`)
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
          void stopJob(decision.reason ?? "kill switch triggered");
        }
      } else if (event.type === "final") {
        finalPayload = event;
      }
    };
    callbackEvents.on("callback", onCallback);

    // Poll job status until it leaves the running/queued states; the live
    // metrics themselves arrive via the tunnel callback above, independent
    // of this polling loop.
    const deadline = Date.now() + (totalMinutes + 10) * 60_000;
    let finished = false;
    while (!finished && !aborted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusResult = await runCli(["job", "get", jobAddress, "--wallet", walletPath, "--network", network, "--format", "json"], 30_000).catch(
        () => null
      );
      if (!statusResult || statusResult.code !== 0) continue;
      try {
        const parsed = JSON.parse(statusResult.stdout);
        const state = String(parsed.state ?? parsed.status ?? "").toUpperCase();
        onProgress(`Nosana job status: ${state}`);
        if (["COMPLETED", "STOPPED", "FAILED"].includes(state)) {
          finished = true;
        }
      } catch {
        // ignore unparsable status lines and keep polling
      }
    }
    callbackEvents.off("callback", onCallback);
    fs.rmSync(flowPath, { force: true });

    if (!finished && !aborted) {
      onProgress("Timed out waiting for the Nosana job to finish; stopping it.");
      await stopJob("submission timeout");
    }

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
