// Minimal best-effort cancellation: a run checks this flag at phase
// boundaries (before dispatching the scan, and before dispatching the load
// test) and stops proceeding if it's set. This does not interrupt work that
// is already in flight inside a Daytona sandbox or a Nosana job — those are
// only actually torn down once the current phase's client call returns.
const cancelledRuns = new Set<string>();

export function requestCancel(runId: string): void {
  cancelledRuns.add(runId);
}

export function isCancelRequested(runId: string): boolean {
  return cancelledRuns.has(runId);
}

export function clearCancel(runId: string): void {
  cancelledRuns.delete(runId);
}
