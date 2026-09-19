import { db } from "../db.js";
import type { Run, RunStatus } from "../types.js";

function rowToRun(row: any): Run {
  return {
    id: row.id,
    targetAddress: row.target_address,
    scopeId: row.scope_id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    tunnelPublicUrl: row.tunnel_public_url,
    failureReason: row.failure_reason,
    abortReason: row.abort_reason,
  };
}

export function createRun(id: string, targetAddress: string, scopeId: string): Run {
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO runs (id, target_address, scope_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(id, targetAddress, scopeId, createdAt);
  return getRun(id)!;
}

export function getRun(id: string): Run | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
  return row ? rowToRun(row) : null;
}

export function listRuns(): Run[] {
  const rows = db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all() as any[];
  return rows.map(rowToRun);
}

export function updateRunStatus(id: string, status: RunStatus, extra: Partial<{ startedAt: string; finishedAt: string; failureReason: string; abortReason: string; tunnelPublicUrl: string }> = {}) {
  const current = getRun(id);
  if (!current) throw new Error(`Run not found: ${id}`);
  const startedAt = extra.startedAt ?? current.startedAt;
  const finishedAt = extra.finishedAt ?? current.finishedAt;
  const failureReason = extra.failureReason ?? current.failureReason;
  const abortReason = extra.abortReason ?? current.abortReason;
  const tunnelPublicUrl = extra.tunnelPublicUrl ?? current.tunnelPublicUrl;
  db.prepare(
    "UPDATE runs SET status = ?, started_at = ?, finished_at = ?, failure_reason = ?, abort_reason = ?, tunnel_public_url = ? WHERE id = ?"
  ).run(status, startedAt, finishedAt, failureReason, abortReason, tunnelPublicUrl, id);
  return getRun(id)!;
}

export function setTunnelToken(id: string, token: string) {
  db.prepare("UPDATE runs SET tunnel_token = ? WHERE id = ?").run(token, id);
}

export function getTunnelToken(id: string): string | null {
  const row = db.prepare("SELECT tunnel_token FROM runs WHERE id = ?").get(id) as any;
  return row?.tunnel_token ?? null;
}
