import crypto from "node:crypto";
import { db } from "../db.js";
import type { Finding, ScanResult } from "../types.js";

export function saveScanResult(
  scan: Omit<ScanResult, "findings"> & { findings: Omit<Finding, "id" | "scanResultId">[] },
  engine: string
): ScanResult {
  db.prepare(
    "INSERT INTO scan_results (id, run_id, started_at, finished_at, raw_report_path, engine) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(scan.id, scan.runId, scan.startedAt, scan.finishedAt, scan.rawReportPath, engine);

  const insertFinding = db.prepare(
    `INSERT INTO findings (id, scan_result_id, title, owasp_category, cvss_score, cvss_vector, severity, affected_endpoint, description, evidence, reproduction_steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findings: Finding[] = scan.findings.map((f) => {
    const id = `finding_${crypto.randomUUID()}`;
    insertFinding.run(id, scan.id, f.title, f.owaspCategory, f.cvssScore, f.cvssVector, f.severity, f.affectedEndpoint, f.description, f.evidence, f.reproductionSteps);
    return { ...f, id, scanResultId: scan.id };
  });

  return { ...scan, findings };
}

export function getScanResultByRun(runId: string): ScanResult | null {
  const row = db.prepare("SELECT * FROM scan_results WHERE run_id = ?").get(runId) as any;
  if (!row) return null;
  const findingRows = db.prepare("SELECT * FROM findings WHERE scan_result_id = ?").all(row.id) as any[];
  return {
    id: row.id,
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rawReportPath: row.raw_report_path,
    findings: findingRows.map((f) => ({
      id: f.id,
      scanResultId: f.scan_result_id,
      title: f.title,
      owaspCategory: f.owasp_category,
      cvssScore: f.cvss_score,
      cvssVector: f.cvss_vector,
      severity: f.severity,
      affectedEndpoint: f.affected_endpoint,
      description: f.description,
      evidence: f.evidence,
      reproductionSteps: f.reproduction_steps,
    })),
  };
}
