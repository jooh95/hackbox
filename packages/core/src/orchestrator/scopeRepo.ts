import crypto from "node:crypto";
import { db } from "../db.js";
import { config } from "../config.js";
import type { ScopeConfig } from "../types.js";

const DEFAULT_SCOPE_ID = "default";

function rowToScope(row: any): ScopeConfig {
  return {
    id: row.id,
    createdAt: row.created_at,
    maxRps: row.max_rps,
    maxDurationSeconds: row.max_duration_seconds,
    errorRateThreshold: row.error_rate_threshold,
    p95LatencyThresholdMs: row.p95_latency_threshold_ms,
    consecutiveBreachLimit: row.consecutive_breach_limit,
    allowedCidrs: JSON.parse(row.allowed_cidrs),
  };
}

export function getScope(id: string): ScopeConfig | null {
  const row = db.prepare("SELECT * FROM scope_configs WHERE id = ?").get(id) as any;
  return row ? rowToScope(row) : null;
}

export function listScopes(): ScopeConfig[] {
  const rows = db.prepare("SELECT * FROM scope_configs ORDER BY created_at DESC").all() as any[];
  return rows.map(rowToScope);
}

export function upsertScope(input: Partial<ScopeConfig> & { id?: string }): ScopeConfig {
  const id = input.id ?? DEFAULT_SCOPE_ID;
  const existing = getScope(id);
  const merged: ScopeConfig = {
    id,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    maxRps: input.maxRps ?? existing?.maxRps ?? 50,
    maxDurationSeconds: input.maxDurationSeconds ?? existing?.maxDurationSeconds ?? 60,
    errorRateThreshold: input.errorRateThreshold ?? existing?.errorRateThreshold ?? 0.2,
    p95LatencyThresholdMs: input.p95LatencyThresholdMs ?? existing?.p95LatencyThresholdMs ?? 2000,
    consecutiveBreachLimit: input.consecutiveBreachLimit ?? existing?.consecutiveBreachLimit ?? 3,
    allowedCidrs: input.allowedCidrs ?? existing?.allowedCidrs ?? config.defaultAllowedCidrs,
  };
  db.prepare(
    `INSERT INTO scope_configs (id, created_at, max_rps, max_duration_seconds, error_rate_threshold, p95_latency_threshold_ms, consecutive_breach_limit, allowed_cidrs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       max_rps = excluded.max_rps,
       max_duration_seconds = excluded.max_duration_seconds,
       error_rate_threshold = excluded.error_rate_threshold,
       p95_latency_threshold_ms = excluded.p95_latency_threshold_ms,
       consecutive_breach_limit = excluded.consecutive_breach_limit,
       allowed_cidrs = excluded.allowed_cidrs`
  ).run(
    merged.id,
    merged.createdAt,
    merged.maxRps,
    merged.maxDurationSeconds,
    merged.errorRateThreshold,
    merged.p95LatencyThresholdMs,
    merged.consecutiveBreachLimit,
    JSON.stringify(merged.allowedCidrs)
  );
  return merged;
}

export function getOrCreateDefaultScope(): ScopeConfig {
  return getScope(DEFAULT_SCOPE_ID) ?? upsertScope({ id: DEFAULT_SCOPE_ID });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
