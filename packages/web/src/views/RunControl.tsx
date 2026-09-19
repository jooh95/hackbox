import { useEffect, useState } from "react";
import { api, ScopeConfig, Run } from "../api";

interface Props {
  targetAddress: string;
  targetValid: boolean;
  onStarted: (runId: string) => void;
}

export default function RunControl({ targetAddress, targetValid, onStarted }: Props) {
  const [scope, setScope] = useState<ScopeConfig | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);

  useEffect(() => {
    api.getScope().then(setScope).catch(() => {});
    api.listRuns().then(setRecentRuns).catch(() => {});
  }, []);

  const runTest = async () => {
    setStarting(true);
    setError(null);
    try {
      const run = await api.startRun(targetAddress);
      onStarted(run.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Run Control</h2>
        <p className="hint">
          One action runs the full pipeline — a Daytona vulnerability scan followed by a Nosana-distributed load test
          against the same target. There is no separate "scan only" mode.
        </p>
        <p>
          Target: <strong>{targetAddress || "(not set — go to Target Setup)"}</strong>{" "}
          {targetAddress && (targetValid ? <span className="badge ok">valid</span> : <span className="badge err">invalid/unchecked</span>)}
        </p>
        <button onClick={runTest} disabled={!targetValid || starting}>
          {starting ? "Starting..." : "Run test"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card">
        <h3>Active scope limits (read-only)</h3>
        {scope ? (
          <table>
            <tbody>
              <tr><th>Max RPS</th><td>{scope.maxRps}</td></tr>
              <tr><th>Max duration</th><td>{scope.maxDurationSeconds}s</td></tr>
              <tr><th>Error-rate abort threshold</th><td>{(scope.errorRateThreshold * 100).toFixed(0)}%</td></tr>
              <tr><th>p95 latency abort threshold</th><td>{scope.p95LatencyThresholdMs}ms</td></tr>
              <tr><th>Consecutive breaches to abort</th><td>{scope.consecutiveBreachLimit}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="hint">Loading...</p>
        )}
        <p className="hint">Adjust via `hackbox scope --max-rps ... --max-duration-seconds ...` on the CLI.</p>
      </div>

      <div className="card">
        <h3>Recent runs</h3>
        <table>
          <thead>
            <tr><th>Target</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {recentRuns.map((r) => (
              <tr key={r.id}>
                <td>{r.targetAddress}</td>
                <td>{r.status}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td><button className="secondary" onClick={() => onStarted(r.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
