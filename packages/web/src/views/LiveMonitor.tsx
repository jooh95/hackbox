import { useEffect, useRef, useState } from "react";
import { api, Run, RunEvent, subscribeToRunEvents } from "../api";

interface Props {
  runId: string | null;
  onOpenReport: () => void;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

export default function LiveMonitor({ runId, onOpenReport }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [livePhase, setLivePhase] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [samples, setSamples] = useState<{ rps: number; errorRate: number; p95: number }[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setSamples([]);
    setLivePhase(null);
    api.getRun(runId).then(({ run }) => setRun(run));
    const unsubscribe = subscribeToRunEvents(runId, (event) => {
      setEvents((prev) => [...prev, event]);
      setLivePhase(event.phase);
      if (event.type === "sample" && event.data) {
        try {
          const parsed = JSON.parse(event.data);
          setSamples((prev) => [...prev.slice(-59), { rps: parsed.rps, errorRate: parsed.errorRate, p95: parsed.p95LatencyMs }]);
        } catch {
          // ignore
        }
      }
      if (TERMINAL_STATUSES.has(event.phase)) {
        api.getRun(runId).then(({ run }) => setRun(run));
      }
    });
    return unsubscribe;
  }, [runId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  if (!runId) {
    return (
      <div className="card">
        <p className="hint">No active run selected. Start one from Run Control, or open one from Report / Audit Log.</p>
      </div>
    );
  }

  const killSwitchEvent = events.find((e) => e.type === "kill_switch");
  const maxRps = Math.max(1, ...samples.map((s) => s.rps));

  return (
    <div className="stack">
      <div className="card">
        <h2>Live Monitor — {run?.targetAddress}</h2>
        <p>
          Status: <span className="badge warn">{livePhase ?? run?.status ?? "loading..."}</span>
          {killSwitchEvent && <span className="badge err" style={{ marginLeft: 8 }}>KILL SWITCH TRIGGERED</span>}
        </p>
        {run && TERMINAL_STATUSES.has(run.status) && (
          <button onClick={onOpenReport}>View report</button>
        )}
      </div>

      {samples.length > 0 && (
        <div className="card">
          <h3>Load test — live samples</h3>
          <div className="row" style={{ alignItems: "flex-end", height: 80, gap: 2 }}>
            {samples.map((s, i) => (
              <div
                key={i}
                title={`rps=${s.rps.toFixed(1)} errorRate=${(s.errorRate * 100).toFixed(1)}% p95=${s.p95.toFixed(0)}ms`}
                style={{
                  width: 6,
                  height: Math.max(2, (s.rps / maxRps) * 80),
                  background: s.errorRate > 0.1 ? "var(--err)" : "var(--accent)",
                }}
              />
            ))}
          </div>
          <p className="hint">Bar height = requests/sec that second; red = elevated error rate.</p>
        </div>
      )}

      <div className="card">
        <h3>Event log</h3>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {events.map((e) => (
            <div key={e.id} className="log-line">
              [{new Date(e.ts).toLocaleTimeString()}] [{e.phase}] {e.type}: {e.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
