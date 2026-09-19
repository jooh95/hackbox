import { EventEmitter } from "node:events";
import { db } from "../db.js";
import type { RunEvent, RunStatus } from "../types.js";

// One process-wide bus; the API layer subscribes per-run to feed SSE streams.
export const runEventBus = new EventEmitter();
runEventBus.setMaxListeners(100);

export function recordEvent(runId: string, phase: RunStatus, type: string, message: string, data?: unknown): RunEvent {
  const ts = new Date().toISOString();
  const dataJson = data === undefined ? null : JSON.stringify(data);
  const stmt = db.prepare(
    "INSERT INTO run_events (run_id, ts, phase, type, message, data) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(runId, ts, phase, type, message, dataJson);
  const event: RunEvent = {
    id: Number(result.lastInsertRowid),
    runId,
    ts,
    phase,
    type,
    message,
    data: dataJson,
  };
  runEventBus.emit(runId, event);
  runEventBus.emit("*", event);
  return event;
}

export function listEvents(runId: string): RunEvent[] {
  const rows = db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC").all(runId) as any[];
  return rows.map(rowToEvent);
}

function rowToEvent(row: any): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    ts: row.ts,
    phase: row.phase,
    type: row.type,
    message: row.message,
    data: row.data,
  };
}
