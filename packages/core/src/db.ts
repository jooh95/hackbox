import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

const dbPath = path.join(config.dataDir, "hackbox.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// All schema is created with IF NOT EXISTS so re-starting the process never
// touches existing data; there is no separate migration runner yet.
db.exec(`
CREATE TABLE IF NOT EXISTS scope_configs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  max_rps INTEGER NOT NULL,
  max_duration_seconds INTEGER NOT NULL,
  error_rate_threshold REAL NOT NULL,
  p95_latency_threshold_ms INTEGER NOT NULL,
  consecutive_breach_limit INTEGER NOT NULL,
  allowed_cidrs TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  target_address TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  tunnel_public_url TEXT,
  tunnel_token TEXT,
  failure_reason TEXT,
  abort_reason TEXT,
  FOREIGN KEY (scope_id) REFERENCES scope_configs(id)
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  phase TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS scan_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  raw_report_path TEXT,
  engine TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  scan_result_id TEXT NOT NULL,
  title TEXT NOT NULL,
  owasp_category TEXT NOT NULL,
  cvss_score REAL,
  cvss_vector TEXT,
  severity TEXT NOT NULL,
  affected_endpoint TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL,
  reproduction_steps TEXT NOT NULL,
  FOREIGN KEY (scan_result_id) REFERENCES scan_results(id)
);

CREATE TABLE IF NOT EXISTS load_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  target_rps INTEGER NOT NULL,
  peak_rps REAL NOT NULL DEFAULT 0,
  overall_error_rate REAL NOT NULL DEFAULT 0,
  p50_latency_ms REAL NOT NULL DEFAULT 0,
  p95_latency_ms REAL NOT NULL DEFAULT 0,
  p99_latency_ms REAL NOT NULL DEFAULT 0,
  kill_switch_triggered INTEGER NOT NULL DEFAULT 0,
  raw_summary_path TEXT,
  engine TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS load_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_result_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  rps REAL NOT NULL,
  error_rate REAL NOT NULL,
  p95_latency_ms REAL NOT NULL,
  FOREIGN KEY (load_result_id) REFERENCES load_results(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  target_address TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  traffic_volume_requests INTEGER NOT NULL,
  findings_by_severity TEXT NOT NULL,
  outcome TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
`);
