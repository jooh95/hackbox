import { useState } from "react";
import TargetSetup from "./views/TargetSetup";
import RunControl from "./views/RunControl";
import LiveMonitor from "./views/LiveMonitor";
import ReportViewer from "./views/ReportViewer";
import AuditLog from "./views/AuditLog";

type Tab = "setup" | "run" | "monitor" | "report" | "audit";

export default function App() {
  const [tab, setTab] = useState<Tab>("setup");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [targetAddress, setTargetAddress] = useState("");
  const [targetValid, setTargetValid] = useState(false);

  const goToRun = (runId: string) => {
    setActiveRunId(runId);
    setTab("monitor");
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "setup", label: "Target Setup" },
    { id: "run", label: "Run Control" },
    { id: "monitor", label: "Live Monitor" },
    { id: "report", label: "Report" },
    { id: "audit", label: "Audit Log" },
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1>🛡️ Hackbox</h1>
        <div className="tabs">
          {tabs.map((t) => (
            <div key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </div>
          ))}
        </div>
      </div>
      <div className="content">
        {tab === "setup" && (
          <TargetSetup targetAddress={targetAddress} onChangeTarget={setTargetAddress} onValidChange={setTargetValid} />
        )}
        {tab === "run" && (
          <RunControl targetAddress={targetAddress} targetValid={targetValid} onStarted={goToRun} />
        )}
        {tab === "monitor" && <LiveMonitor runId={activeRunId} onOpenReport={() => setTab("report")} />}
        {tab === "report" && <ReportViewer runId={activeRunId} onSelectRun={setActiveRunId} />}
        {tab === "audit" && <AuditLog />}
      </div>
    </div>
  );
}
