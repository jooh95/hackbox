import type { Severity } from "../types.js";

export type ZapRisk = "High" | "Medium" | "Low" | "Informational";

// Mirrors the table in docs/03-daytona-vulnerability-scanning.md: ZAP's own
// risk rating maps to a CVSS score range and severity band. When ZAP doesn't
// give a precise vector we only populate score + severity — never fabricate
// a vector.
const CVSS_RANGE_MIDPOINT: Record<ZapRisk, { score: number; severity: Severity }> = {
  High: { score: 8.5, severity: "high" },
  Medium: { score: 5.5, severity: "medium" },
  Low: { score: 2.0, severity: "low" },
  Informational: { score: 0.0, severity: "info" },
};

export function mapZapRiskToCvss(risk: string): { score: number; severity: Severity } {
  const normalized = (risk as ZapRisk) in CVSS_RANGE_MIDPOINT ? (risk as ZapRisk) : "Informational";
  return CVSS_RANGE_MIDPOINT[normalized];
}

export function severityRank(s: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s];
}
