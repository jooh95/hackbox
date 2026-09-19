import { EventEmitter } from "node:events";
import { validateLocalTarget } from "../validator.js";
import { openTunnel, type TunnelHandle } from "../tunnel/manager.js";
import { createScannerClient } from "../daytona/index.js";
import { createLoadTestClient } from "../nosana/index.js";
import { createConsecutiveBreachKillSwitch } from "./killSwitch.js";
import { isCancelRequested, clearCancel } from "./cancel.js";
import { recordEvent } from "./events.js";
import { createRun, getRun, updateRunStatus } from "./runRepo.js";
import { getScope, newId } from "./scopeRepo.js";
import { saveScanResult } from "./scanRepo.js";
import { saveLoadResult } from "./loadRepo.js";
import { generateMarkdownReport, writeMarkdownReport } from "../report/markdown.js";
import { appendAuditEntry } from "../audit/log.js";
import type { LoadSample, Run, Severity } from "../types.js";

class RunFailure extends Error {}

export function startRun(targetAddress: string, scopeId: string): Run {
  const scope = getScope(scopeId);
  if (!scope) throw new Error(`Unknown scope: ${scopeId}`);
  const run = createRun(newId("run"), targetAddress, scopeId);
  recordEvent(run.id, "pending", "run_created", `Run created for target "${targetAddress}"`);
  void executeRun(run.id).catch((err) => {
    // executeRun already handles its own errors internally; this is a
    // last-resort net so a truly unexpected throw can't be silently lost.
    recordEvent(run.id, "failed", "unexpected_error", `Unexpected error: ${(err as Error).message}`);
    updateRunStatus(run.id, "failed", { finishedAt: new Date().toISOString(), failureReason: (err as Error).message });
  });
  return run;
}

async function executeRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const scope = getScope(run.scopeId);
  if (!scope) throw new Error(`Scope not found: ${run.scopeId}`);

  const startedAt = new Date().toISOString();
  updateRunStatus(runId, "validating", { startedAt });
  recordEvent(runId, "validating", "phase_start", "Validating that the target is local/private...");

  let tunnel: TunnelHandle | null = null;
  const callbackEvents = new EventEmitter();

  try {
    const initialValidation = await validateLocalTarget(run.targetAddress, scope.allowedCidrs);
    if (!initialValidation.ok) {
      throw new RunFailure(`Target rejected: ${initialValidation.reason}`);
    }
    recordEvent(runId, "validating", "validated", `Target resolved to ${initialValidation.resolvedIp} — within allowed local/private ranges.`);

    // Re-validate immediately before opening the tunnel (defense in depth
    // against DNS rebinding between the initial check and dispatch).
    const preTunnelValidation = await validateLocalTarget(run.targetAddress, scope.allowedCidrs);
    if (!preTunnelValidation.ok) {
      throw new RunFailure(`Target failed re-validation before dispatch: ${preTunnelValidation.reason}`);
    }

    recordEvent(runId, "validating", "tunnel_opening", "Opening ephemeral tunnel to the local target...");
    tunnel = await openTunnel({
      localTargetUrl: preTunnelValidation.normalizedUrl!,
      onCallback: (event) => callbackEvents.emit("callback", event),
      ttlMs: Math.max(30 * 60_000, scope.maxDurationSeconds * 1000 * 3),
    });
    updateRunStatus(runId, "validating", { tunnelPublicUrl: tunnel.targetBaseUrl });
    recordEvent(runId, "validating", "tunnel_opened", `Tunnel open: ${tunnel.targetBaseUrl}`);

    if (isCancelRequested(runId)) throw new RunFailure("Run cancelled before the scan phase started.");

    // --- Scan phase ---
    updateRunStatus(runId, "scanning");
    recordEvent(runId, "scanning", "phase_start", "Starting vulnerability scan...");
    const rescanValidation = await validateLocalTarget(run.targetAddress, scope.allowedCidrs);
    if (!rescanValidation.ok) {
      throw new RunFailure(`Target failed re-validation before scan dispatch: ${rescanValidation.reason}`);
    }
    const scannerClient = createScannerClient();
    recordEvent(runId, "scanning", "engine", `Scanner engine: ${scannerClient.engine}`);
    const rawScan = await scannerClient.runScan({
      runId,
      targetBaseUrl: tunnel.targetBaseUrl,
      onProgress: (message) => recordEvent(runId, "scanning", "progress", message),
    });
    const scanResult = saveScanResult(rawScan, scannerClient.engine);
    recordEvent(runId, "scanning", "phase_done", `Scan complete: ${scanResult.findings.length} finding(s).`, {
      findingCount: scanResult.findings.length,
    });

    if (isCancelRequested(runId)) throw new RunFailure("Run cancelled before the load-test phase started.");

    // --- Load test phase (sequential, after scan — see docs/02) ---
    updateRunStatus(runId, "load_testing");
    recordEvent(runId, "load_testing", "phase_start", "Starting load / resilience test...");
    const preLoadValidation = await validateLocalTarget(run.targetAddress, scope.allowedCidrs);
    if (!preLoadValidation.ok) {
      throw new RunFailure(`Target failed re-validation before load-test dispatch: ${preLoadValidation.reason}`);
    }
    const killSwitch = createConsecutiveBreachKillSwitch({
      errorRateThreshold: scope.errorRateThreshold,
      p95LatencyThresholdMs: scope.p95LatencyThresholdMs,
      consecutiveBreachLimit: scope.consecutiveBreachLimit,
    });
    const totalSeconds = Math.max(6, scope.maxDurationSeconds);
    const rampUpSeconds = Math.max(1, Math.round(totalSeconds * 0.2));
    const rampDownSeconds = Math.max(1, Math.round(totalSeconds * 0.2));
    const holdSeconds = Math.max(1, totalSeconds - rampUpSeconds - rampDownSeconds);
    const targetRps = Math.max(1, scope.maxRps);

    const samples: LoadSample[] = [];
    const loadTestClient = createLoadTestClient();
    recordEvent(runId, "load_testing", "engine", `Load-test engine: ${loadTestClient.engine}`);
    let abortReason: string | null = null;
    const rawLoad = await loadTestClient.runLoadTest({
      runId,
      targetBaseUrl: tunnel.targetBaseUrl,
      callbackUrl: tunnel.callbackUrl,
      targetRps,
      rampUpSeconds,
      holdSeconds,
      rampDownSeconds,
      killSwitch,
      callbackEvents,
      onSample: (sample) => {
        samples.push(sample);
        recordEvent(runId, "load_testing", "sample", `rps=${sample.rps.toFixed(1)} errorRate=${(sample.errorRate * 100).toFixed(1)}% p95=${sample.p95LatencyMs.toFixed(0)}ms`, sample);
      },
      onProgress: (message) => recordEvent(runId, "load_testing", "progress", message),
      onAbort: (reason) => {
        abortReason = reason;
        recordEvent(runId, "load_testing", "kill_switch", `Kill switch triggered: ${reason}`);
      },
    });
    const loadResult = saveLoadResult(rawLoad, loadTestClient.engine, samples);
    recordEvent(runId, "load_testing", "phase_done", `Load test complete: peak ${loadResult.peakRps.toFixed(1)} rps, error rate ${(loadResult.overallErrorRate * 100).toFixed(1)}%.`);

    // --- Aggregation / reporting ---
    updateRunStatus(runId, "aggregating");
    recordEvent(runId, "aggregating", "phase_start", "Generating report...");
    const finishedAt = new Date().toISOString();
    const finalRunForReport: Run = { ...run, status: abortReason ? "aborted" : "completed", startedAt, finishedAt, abortReason };
    const markdown = generateMarkdownReport(finalRunForReport, scanResult, loadResult);
    const reportPath = writeMarkdownReport(finalRunForReport, markdown);
    recordEvent(runId, "aggregating", "report_written", `Markdown report written to ${reportPath}`);

    const findingsBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of scanResult.findings) findingsBySeverity[f.severity]++;
    const trafficVolumeRequests = samples.reduce((sum, s) => sum + s.rps, 0);

    const finalStatus = abortReason ? "aborted" : "completed";
    updateRunStatus(runId, finalStatus, { finishedAt, abortReason: abortReason ?? undefined });
    appendAuditEntry({
      runId,
      targetAddress: run.targetAddress,
      startedAt,
      endedAt: finishedAt,
      trafficVolumeRequests,
      findingsBySeverity,
      outcome: finalStatus,
    });
    recordEvent(runId, finalStatus, "run_finished", `Run finished with status "${finalStatus}".`);
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    updateRunStatus(runId, "failed", { finishedAt, failureReason: message });
    recordEvent(runId, "failed", "run_failed", `Run failed: ${message}`);
    appendAuditEntry({
      runId,
      targetAddress: run.targetAddress,
      startedAt,
      endedAt: finishedAt,
      trafficVolumeRequests: 0,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      outcome: "failed",
    });
  } finally {
    if (tunnel) {
      await tunnel.close();
      recordEvent(runId, "aggregating", "tunnel_closed", "Tunnel closed.");
    }
    clearCancel(runId);
  }
}
