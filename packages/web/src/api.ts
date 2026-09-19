export interface ScopeConfig {
  id: string;
  maxRps: number;
  maxDurationSeconds: number;
  errorRateThreshold: number;
  p95LatencyThresholdMs: number;
  consecutiveBreachLimit: number;
  allowedCidrs: string[];
}

export type RunStatus =
  | "pending"
  | "validating"
  | "scanning"
  | "load_testing"
  | "aggregating"
  | "completed"
  | "failed"
  | "aborted";

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

export interface Finding {
  id: string;
  title: string;
  owaspCategory: string;
  cvssScore: number | null;
  severity: "critical" | "high" | "medium" | "low" | "info";
  affectedEndpoint: string;
  description: string;
  evidence: string;
  reproductionSteps: string;
}

export interface ScanResult {
  id: string;
  startedAt: string;
  finishedAt: string | null;
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
  targetRps: number;
  peakRps: number;
  overallErrorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  killSwitchTriggered: boolean;
  samples: LoadSample[];
}

export interface RunEvent {
  id: number;
  runId: string;
  ts: string;
  phase: RunStatus;
  type: string;
  message: string;
  data: string | null;
}

export interface AuditEntry {
  seq: number;
  runId: string;
  targetAddress: string;
  startedAt: string;
  endedAt: string;
  trafficVolumeRequests: number;
  findingsBySeverity: Record<string, number>;
  outcome: RunStatus;
  hash: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.reason ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getScope: () => fetch("/api/scope").then((r) => json<ScopeConfig>(r)),
  validateTarget: (address: string) =>
    fetch("/api/validate-target", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    }).then((r) => r.json() as Promise<{ ok: boolean; reason?: string; resolvedIp?: string }>),
  startLocalTarget: () => fetch("/api/local-target/start", { method: "POST" }).then((r) => json<{ started: boolean; url: string }>(r)),
  localTargetStatus: () => fetch("/api/local-target/status").then((r) => json<{ running: boolean; url: string }>(r)),
  startRun: (targetAddress: string) =>
    fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetAddress }),
    }).then((r) => json<Run>(r)),
  listRuns: () => fetch("/api/runs").then((r) => json<Run[]>(r)),
  getRun: (id: string) => fetch(`/api/runs/${id}`).then((r) => json<{ run: Run; scan: ScanResult | null; load: LoadResult | null }>(r)),
  cancelRun: (id: string) => fetch(`/api/runs/${id}/cancel`, { method: "POST" }).then((r) => json<{ cancelRequested: boolean }>(r)),
  getAudit: () => fetch("/api/audit").then((r) => json<{ entries: AuditEntry[]; verification: { ok: boolean; brokenAtSeq?: number; reason?: string } }>(r)),
  reportMdUrl: (id: string) => `/api/runs/${id}/report.md`,
  reportPdfUrl: (id: string) => `/api/runs/${id}/report.pdf`,
};

export function subscribeToRunEvents(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore malformed/comment lines
    }
  };
  return () => source.close();
}
