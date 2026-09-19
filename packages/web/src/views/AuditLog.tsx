import { useEffect, useState } from "react";
import { api, AuditEntry } from "../api";

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verification, setVerification] = useState<{ ok: boolean; brokenAtSeq?: number; reason?: string } | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.getAudit().then((res) => {
      setEntries(res.entries);
      setVerification(res.verification);
    });
  }, []);

  const filtered = entries.filter((e) => e.targetAddress.toLowerCase().includes(filter.toLowerCase()) || e.outcome.includes(filter.toLowerCase()));

  return (
    <div className="stack">
      <div className="card">
        <h2>Audit Log</h2>
        <p>
          Integrity check:{" "}
          {verification?.ok ? (
            <span className="badge ok">chain intact</span>
          ) : (
            <span className="badge err">BROKEN at seq {verification?.brokenAtSeq} — {verification?.reason}</span>
          )}
        </p>
        <input type="text" placeholder="Filter by target or outcome..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Seq</th><th>Target</th><th>Started</th><th>Ended</th><th>Requests</th><th>Findings</th><th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.seq}>
                <td>{e.seq}</td>
                <td>{e.targetAddress}</td>
                <td>{new Date(e.startedAt).toLocaleString()}</td>
                <td>{new Date(e.endedAt).toLocaleString()}</td>
                <td>{e.trafficVolumeRequests}</td>
                <td>
                  {Object.entries(e.findingsBySeverity)
                    .filter(([, count]) => count > 0)
                    .map(([sev, count]) => `${sev}:${count}`)
                    .join(" ") || "none"}
                </td>
                <td>{e.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
