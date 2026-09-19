import crypto from "node:crypto";
import { db } from "../db.js";
import type { AuditEntry, RunStatus, Severity } from "../types.js";

const GENESIS_HASH = "0".repeat(64);

function computeHash(entry: Omit<AuditEntry, "hash">): string {
  const payload = JSON.stringify({
    seq: entry.seq,
    runId: entry.runId,
    targetAddress: entry.targetAddress,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    trafficVolumeRequests: entry.trafficVolumeRequests,
    findingsBySeverity: entry.findingsBySeverity,
    outcome: entry.outcome,
    prevHash: entry.prevHash,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getLastHash(): string {
  const row = db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as any;
  return row?.hash ?? GENESIS_HASH;
}

export function appendAuditEntry(input: {
  runId: string;
  targetAddress: string;
  startedAt: string;
  endedAt: string;
  trafficVolumeRequests: number;
  findingsBySeverity: Record<Severity, number>;
  outcome: RunStatus;
}): AuditEntry {
  const prevHash = getLastHash();
  const stmt = db.prepare(
    `INSERT INTO audit_log (run_id, target_address, started_at, ended_at, traffic_volume_requests, findings_by_severity, outcome, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // seq is only known after insert (AUTOINCREMENT), but the hash must cover
  // the real seq, so insert with a placeholder hash and then fix it up in
  // the same transaction-like sequence before anything else can read it.
  const result = stmt.run(input.runId, input.targetAddress, input.startedAt, input.endedAt, input.trafficVolumeRequests, JSON.stringify(input.findingsBySeverity), input.outcome, prevHash, "pending");
  const seq = Number(result.lastInsertRowid);
  const entry: AuditEntry = { ...input, seq, prevHash, hash: "" };
  entry.hash = computeHash(entry);
  db.prepare("UPDATE audit_log SET hash = ? WHERE seq = ?").run(entry.hash, seq);
  return entry;
}

export function listAuditEntries(): AuditEntry[] {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq ASC").all() as any[];
  return rows.map(rowToEntry);
}

function rowToEntry(row: any): AuditEntry {
  return {
    seq: row.seq,
    runId: row.run_id,
    targetAddress: row.target_address,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    trafficVolumeRequests: row.traffic_volume_requests,
    findingsBySeverity: JSON.parse(row.findings_by_severity),
    outcome: row.outcome,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

export interface AuditVerificationResult {
  ok: boolean;
  brokenAtSeq?: number;
  reason?: string;
}

/** Recomputes every entry's hash and chain link; any past edit breaks this. */
export function verifyAuditLog(): AuditVerificationResult {
  const entries = listAuditEntries();
  let expectedPrevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrevHash) {
      return { ok: false, brokenAtSeq: entry.seq, reason: "prevHash does not match the preceding entry's hash" };
    }
    const { hash: _hash, ...withoutHash } = entry;
    const recomputed = computeHash(withoutHash);
    if (recomputed !== entry.hash) {
      return { ok: false, brokenAtSeq: entry.seq, reason: "stored hash does not match the entry's own content" };
    }
    expectedPrevHash = entry.hash;
  }
  return { ok: true };
}
