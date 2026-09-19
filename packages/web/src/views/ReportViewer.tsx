import { useEffect, useState } from "react";
import { api, Run, ScanResult, LoadResult } from "../api";

interface Props {
  runId: string | null;
  onSelectRun: (id: string) => void;
}

export default function ReportViewer({ runId, onSelectRun }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [load, setLoad] = useState<LoadResult | null>(null);
  const [history, setHistory] = useState<Run[]>([]);

  useEffect(() => {
    api.listRuns().then(setHistory).catch(() => {});
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    api.getRun(runId).then(({ run, scan, load }) => {
      setRun(run);
      setScan(scan);
      setLoad(load);
    });
  }, [runId]);

  return (
    <div className="stack">
      <div className="card">
        <h2>Report</h2>
        {!run && <p className="hint">Select a run from the history below, or from Run Control.</p>}
        {run && (
          <>
            <p>
              <strong>{run.targetAddress}</strong> — <span className="badge warn">{run.status}</span>
            </p>
            {run.failureReason && <p className="error-text">Failure: {run.failureReason}</p>}
            {run.abortReason && <p className="error-text">Aborted: {run.abortReason}</p>}
            {(run.status === "completed" || run.status === "aborted") && (
              <div className="row">
                <a href={api.reportMdUrl(run.id)} target="_blank" rel="noreferrer">
                  <button className="secondary">Download Markdown</button>
                </a>
                <a href={api.reportPdfUrl(run.id)} target="_blank" rel="noreferrer">
                  <button className="secondary">Download PDF</button>
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {load && (
        <div className="card">
          <h3>Load / resilience summary</h3>
          <table>
            <tbody>
              <tr><th>Target RPS</th><td>{load.targetRps}</td></tr>
              <tr><th>Peak RPS achieved</th><td>{load.peakRps.toFixed(1)}</td></tr>
              <tr><th>Overall error rate</th><td>{(load.overallErrorRate * 100).toFixed(2)}%</td></tr>
              <tr><th>p50 / p95 / p99 latency</th><td>{load.p50LatencyMs.toFixed(0)} / {load.p95LatencyMs.toFixed(0)} / {load.p99LatencyMs.toFixed(0)} ms</td></tr>
              <tr><th>Kill switch triggered</th><td>{load.killSwitchTriggered ? "Yes" : "No"}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {scan && (
        <div className="card">
          <h3>Findings ({scan.findings.length})</h3>
          {scan.findings.length === 0 && <p className="hint">No findings reported.</p>}
          {[...scan.findings]
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
            .map((f) => (
              <div className="finding" key={f.id}>
                <div className="row">
                  <span className={`badge ${f.severity}`}>{f.severity.toUpperCase()}</span>
                  <strong>{f.title}</strong>
                </div>
                <p className="hint">{f.owaspCategory} · CVSS {f.cvssScore ?? "n/a"} · {f.affectedEndpoint}</p>
                <p>{f.description}</p>
                <p className="hint">Evidence: {f.evidence}</p>
                <p className="hint">Reproduce: {f.reproductionSteps}</p>
              </div>
            ))}
        </div>
      )}

      <div className="card">
        <h3>History</h3>
        <table>
          <thead>
            <tr><th>Target</th><th>Status</th><th>Finished</th><th></th></tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td>{r.targetAddress}</td>
                <td>{r.status}</td>
                <td>{r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "-"}</td>
                <td><button className="secondary" onClick={() => onSelectRun(r.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s as "critical"] ?? 0;
}
