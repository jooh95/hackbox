import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLoadGeneratorScript } from "./loadGeneratorScript.js";
import type { LoadTestClient, RunLoadTestParams } from "./types.js";
import type { LoadResult } from "../types.js";

/**
 * Runs the same load-generator script that the real Nosana job would run,
 * but as a plain local child process instead of a distributed job. Used
 * whenever NOSANA_WALLET_PRIVATE_KEY is not configured, so the full
 * validate -> tunnel -> load-test -> kill-switch -> report pipeline can be
 * exercised end-to-end without a funded Solana wallet.
 */
export class LocalLoadTestClient implements LoadTestClient {
  readonly engine = "local-node-process";

  async runLoadTest(params: RunLoadTestParams): Promise<Omit<LoadResult, "samples">> {
    const { runId, targetBaseUrl, callbackUrl, targetRps, rampUpSeconds, holdSeconds, rampDownSeconds, killSwitch, callbackEvents, onSample, onProgress, onAbort } = params;
    const startedAt = new Date().toISOString();

    const scriptPath = path.join(os.tmpdir(), `hackbox-load-${runId}.mjs`);
    fs.writeFileSync(scriptPath, buildLoadGeneratorScript());

    onProgress(`[local load test] Starting local load generator against ${targetBaseUrl}`);
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        TARGET_URL: targetBaseUrl,
        CALLBACK_URL: callbackUrl,
        TARGET_RPS: String(targetRps),
        RAMP_UP_SECONDS: String(rampUpSeconds),
        HOLD_SECONDS: String(holdSeconds),
        RAMP_DOWN_SECONDS: String(rampDownSeconds),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let aborted = false;
    let peakRps = 0;
    let lastSamples: { errorRate: number; p95: number }[] = [];
    let finalPayload: any = null;

    const onCallback = (event: any) => {
      if (event.type === "sample") {
        peakRps = Math.max(peakRps, event.rps);
        lastSamples.push({ errorRate: event.errorRate, p95: event.p95LatencyMs });
        onSample({ ts: event.ts, rps: event.rps, errorRate: event.errorRate, p95LatencyMs: event.p95LatencyMs });
        const decision = killSwitch.evaluate({ errorRate: event.errorRate, p95LatencyMs: event.p95LatencyMs });
        if (decision.shouldAbort && !aborted) {
          aborted = true;
          onAbort(decision.reason ?? "kill switch triggered");
          onProgress("[local load test] Kill switch triggered — terminating local load generator process.");
          child.kill("SIGTERM");
        }
      } else if (event.type === "final") {
        finalPayload = event;
      }
    };
    callbackEvents.on("callback", onCallback);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) onProgress(`[local load test] ${text}`);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) onProgress(`[local load test][stderr] ${text}`);
    });

    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
    });
    callbackEvents.off("callback", onCallback);
    fs.rmSync(scriptPath, { force: true });

    const sorted = lastSamples.map((s) => s.p95).sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

    return {
      id: `load_${crypto.randomUUID()}`,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      targetRps,
      peakRps: finalPayload?.peakRps ?? peakRps,
      overallErrorRate: finalPayload?.overallErrorRate ?? (lastSamples.length ? lastSamples.reduce((a, s) => a + s.errorRate, 0) / lastSamples.length : 0),
      p50LatencyMs: finalPayload?.p50LatencyMs ?? pct(50),
      p95LatencyMs: finalPayload?.p95LatencyMs ?? pct(95),
      p99LatencyMs: finalPayload?.p99LatencyMs ?? pct(99),
      killSwitchTriggered: aborted,
      rawSummaryPath: null,
    };
  }
}
