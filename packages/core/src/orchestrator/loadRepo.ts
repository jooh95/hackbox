import { db } from "../db.js";
import type { LoadResult, LoadSample } from "../types.js";

export function saveLoadResult(result: Omit<LoadResult, "samples">, engine: string, samples: LoadSample[]): LoadResult {
  db.prepare(
    `INSERT INTO load_results (id, run_id, started_at, finished_at, target_rps, peak_rps, overall_error_rate, p50_latency_ms, p95_latency_ms, p99_latency_ms, kill_switch_triggered, raw_summary_path, engine)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    result.id,
    result.runId,
    result.startedAt,
    result.finishedAt,
    result.targetRps,
    result.peakRps,
    result.overallErrorRate,
    result.p50LatencyMs,
    result.p95LatencyMs,
    result.p99LatencyMs,
    result.killSwitchTriggered ? 1 : 0,
    result.rawSummaryPath,
    engine
  );
  const insertSample = db.prepare(
    "INSERT INTO load_samples (load_result_id, ts, rps, error_rate, p95_latency_ms) VALUES (?, ?, ?, ?, ?)"
  );
  for (const s of samples) {
    insertSample.run(result.id, s.ts, s.rps, s.errorRate, s.p95LatencyMs);
  }
  return { ...result, samples };
}

export function getLoadResultByRun(runId: string): LoadResult | null {
  const row = db.prepare("SELECT * FROM load_results WHERE run_id = ?").get(runId) as any;
  if (!row) return null;
  const sampleRows = db.prepare("SELECT * FROM load_samples WHERE load_result_id = ? ORDER BY id ASC").all(row.id) as any[];
  return {
    id: row.id,
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    targetRps: row.target_rps,
    peakRps: row.peak_rps,
    overallErrorRate: row.overall_error_rate,
    p50LatencyMs: row.p50_latency_ms,
    p95LatencyMs: row.p95_latency_ms,
    p99LatencyMs: row.p99_latency_ms,
    killSwitchTriggered: !!row.kill_switch_triggered,
    rawSummaryPath: row.raw_summary_path,
    samples: sampleRows.map((s) => ({ ts: s.ts, rps: s.rps, errorRate: s.error_rate, p95LatencyMs: s.p95_latency_ms })),
  };
}
