// Shared domain types used across the orchestrator, API, CLI, and dashboard.

export type RunStatus =
  | "pending"
  | "validating"
  | "scanning"
  | "load_testing"
  | "aggregating"
  | "completed"
  | "failed"
  | "aborted";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface ScopeConfig {
  id: string;
  createdAt: string;
  maxRps: number;
  maxDurationSeconds: number;
  errorRateThreshold: number; // fraction, e.g. 0.2 for 20%
  p95LatencyThresholdMs: number;
  consecutiveBreachLimit: number;
  allowedCidrs: string[];
}

export interface Run {
  id: string;
  targetAddress: string;
  scopeId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  tunnelPublicUrl: string | null;
  failureReason: string | null;
  abortReason: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  ts: string;
  phase: RunStatus;
  type: string;
  message: string;
  data: string | null; // JSON-encoded payload
}

export interface Finding {
  id: string;
  scanResultId: string;
  title: string;
  owaspCategory: string;
  cvssScore: number | null;
  cvssVector: string | null;
  severity: Severity;
  affectedEndpoint: string;
  description: string;
  evidence: string;
  reproductionSteps: string;
}

export interface ScanResult {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  rawReportPath: string | null;
  findings: Finding[];
}

export interface LoadSample {
  ts: string;
  rps: number;
  errorRate: number;
  p95LatencyMs: number;
}

export interface LoadResult {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  targetRps: number;
  peakRps: number;
  overallErrorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  killSwitchTriggered: boolean;
  rawSummaryPath: string | null;
  samples: LoadSample[];
}

export interface AuditEntry {
  seq: number;
  runId: string;
  targetAddress: string;
  startedAt: string;
  endedAt: string;
  trafficVolumeRequests: number;
  findingsBySeverity: Record<Severity, number>;
  outcome: RunStatus;
  prevHash: string;
  hash: string;
}

export interface KillSwitchSample {
  errorRate: number;
  p95LatencyMs: number;
}

export interface KillSwitchDecision {
  shouldAbort: boolean;
  reason?: string;
}

export interface KillSwitch {
  /** Feed one live sample; returns whether the run should now abort. */
  evaluate(sample: KillSwitchSample): KillSwitchDecision;
  reset(): void;
}
