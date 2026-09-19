import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { severityRank } from "../daytona/cvss.js";
import type { Run, ScanResult, LoadResult, Severity } from "../types.js";

function severityBadge(s: Severity): string {
  return { critical: "🟥 CRITICAL", high: "🟧 HIGH", medium: "🟨 MEDIUM", low: "🟦 LOW", info: "⬜ INFO" }[s];
}

function recommendationsFor(scan: ScanResult, load: LoadResult): string[] {
  const recs: string[] = [];
  const bySeverity = new Set(scan.findings.map((f) => f.severity));
  if (bySeverity.has("critical") || bySeverity.has("high")) {
    recs.push("Address the high/critical findings below before considering this target production-ready.");
  }
  if (scan.findings.some((f) => /header|csp|clickjack|hsts/i.test(f.title))) {
    recs.push("Add the missing security response headers (CSP, X-Content-Type-Options, X-Frame-Options, HSTS).");
  }
  if (scan.findings.some((f) => /cookie/i.test(f.title))) {
    recs.push("Set the HttpOnly and Secure flags on all session cookies.");
  }
  if (load.killSwitchTriggered) {
    recs.push("The load test was aborted by the kill switch — investigate the error-rate/latency spike before re-testing at this traffic level.");
  } else if (load.overallErrorRate > 0.01) {
    recs.push(`The error rate (${(load.overallErrorRate * 100).toFixed(2)}%) stayed under the abort threshold but is non-zero — investigate the failing requests.`);
  }
  if (recs.length === 0) recs.push("No immediate action items — re-run periodically as the target evolves.");
  return recs;
}

export function generateMarkdownReport(run: Run, scan: ScanResult, load: LoadResult): string {
  const sortedFindings = [...scan.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of scan.findings) counts[f.severity]++;

  const lines: string[] = [];
  lines.push(`# Hackbox Report — ${run.targetAddress}`);
  lines.push("");
  lines.push(`**Run ID:** \`${run.id}\`  `);
  lines.push(`**Outcome:** ${run.status}  `);
  lines.push(`**Started:** ${run.startedAt ?? "n/a"}  `);
  lines.push(`**Finished:** ${run.finishedAt ?? "n/a"}  `);
  if (run.abortReason) lines.push(`**Abort reason:** ${run.abortReason}  `);
  if (run.failureReason) lines.push(`**Failure reason:** ${run.failureReason}  `);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Findings: ${scan.findings.length} total (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.info} info)`);
  lines.push(`- Peak load achieved: ${load.peakRps.toFixed(1)} req/s (target ${load.targetRps} req/s)`);
  lines.push(`- Overall error rate: ${(load.overallErrorRate * 100).toFixed(2)}%`);
  lines.push(`- Latency: p50 ${load.p50LatencyMs.toFixed(0)}ms / p95 ${load.p95LatencyMs.toFixed(0)}ms / p99 ${load.p99LatencyMs.toFixed(0)}ms`);
  lines.push(`- Kill switch triggered: ${load.killSwitchTriggered ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Vulnerability Findings (sorted by severity)");
  lines.push("");
  if (sortedFindings.length === 0) {
    lines.push("_No findings were reported by the scanner for this run._");
  }
  for (const f of sortedFindings) {
    lines.push(`### ${severityBadge(f.severity)} — ${f.title}`);
    lines.push("");
    lines.push(`- **OWASP category:** ${f.owaspCategory}`);
    lines.push(`- **CVSS:** ${f.cvssScore ?? "n/a"}${f.cvssVector ? ` (${f.cvssVector})` : ""}`);
    lines.push(`- **Affected endpoint:** ${f.affectedEndpoint}`);
    lines.push("");
    lines.push(f.description);
    lines.push("");
    lines.push(`**Evidence:** ${f.evidence}`);
    lines.push("");
    lines.push(`**Reproduction:** ${f.reproductionSteps}`);
    lines.push("");
  }
  lines.push("## Load / Resilience Results");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Target RPS | ${load.targetRps} |`);
  lines.push(`| Peak RPS achieved | ${load.peakRps.toFixed(1)} |`);
  lines.push(`| Overall error rate | ${(load.overallErrorRate * 100).toFixed(2)}% |`);
  lines.push(`| p50 latency | ${load.p50LatencyMs.toFixed(0)} ms |`);
  lines.push(`| p95 latency | ${load.p95LatencyMs.toFixed(0)} ms |`);
  lines.push(`| p99 latency | ${load.p99LatencyMs.toFixed(0)} ms |`);
  lines.push(`| Kill switch triggered | ${load.killSwitchTriggered ? "Yes" : "No"} |`);
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  for (const r of recommendationsFor(scan, load)) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Appendix — Sample Time Series");
  lines.push("");
  lines.push("| Time | RPS | Error rate | p95 latency |");
  lines.push("|---|---|---|---|");
  for (const s of load.samples) {
    lines.push(`| ${s.ts} | ${s.rps.toFixed(1)} | ${(s.errorRate * 100).toFixed(1)}% | ${s.p95LatencyMs.toFixed(0)}ms |`);
  }
  lines.push("");
  lines.push(`_Raw scanner report: \`${scan.rawReportPath ?? "n/a"}\`_`);
  lines.push("");

  return lines.join("\n");
}

export function writeMarkdownReport(run: Run, markdown: string): string {
  const dir = path.join(config.reportsDir, run.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "report.md");
  fs.writeFileSync(filePath, markdown, "utf8");
  return filePath;
}

export function getReportPath(runId: string, ext: "md" | "pdf"): string {
  return path.join(config.reportsDir, runId, `report.${ext}`);
}
