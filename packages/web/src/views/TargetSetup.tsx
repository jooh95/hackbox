import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface Props {
  targetAddress: string;
  onChangeTarget: (value: string) => void;
  onValidChange: (valid: boolean) => void;
}

export default function TargetSetup({ targetAddress, onChangeTarget, onValidChange }: Props) {
  const [validation, setValidation] = useState<{ ok: boolean; reason?: string; resolvedIp?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [localTargetStatus, setLocalTargetStatus] = useState<{ running: boolean; url: string } | null>(null);
  const [bringingUp, setBringingUp] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.localTargetStatus().then(setLocalTargetStatus).catch(() => {});
    const interval = setInterval(() => {
      api.localTargetStatus().then(setLocalTargetStatus).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!targetAddress.trim()) {
      setValidation(null);
      onValidChange(false);
      return;
    }
    setChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api
        .validateTarget(targetAddress)
        .then((result) => {
          setValidation(result);
          onValidChange(result.ok);
        })
        .finally(() => setChecking(false));
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAddress]);

  const bringUpSample = async () => {
    setBringingUp(true);
    try {
      const result = await api.startLocalTarget();
      setLocalTargetStatus({ running: true, url: result.url });
      onChangeTarget(result.url);
    } catch (err) {
      alert(`Failed to start local sample target: ${(err as Error).message}`);
    } finally {
      setBringingUp(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Target Setup</h2>
        <p className="hint">
          Only local/private addresses are accepted (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, etc.).
          External domains are out of scope for this tool for legal-safety reasons — Hackbox exposes local targets to
          Daytona/Nosana through a short-lived, token-authenticated tunnel instead.
        </p>
        <div className="stack">
          <label htmlFor="target-address">Address to test</label>
          <input
            id="target-address"
            type="text"
            placeholder="http://localhost:4000"
            value={targetAddress}
            onChange={(e) => onChangeTarget(e.target.value)}
          />
          <div className="row">
            {checking && <span className="hint">Checking...</span>}
            {!checking && validation?.ok && (
              <span className="badge ok">Reachable &amp; local — resolved to {validation.resolvedIp}</span>
            )}
            {!checking && validation && !validation.ok && <span className="badge err">{validation.reason}</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Don't have a local app running?</h3>
        <p className="hint">Bring up the bundled sample vulnerable target (a small Express app on port 4000) to try Hackbox end-to-end.</p>
        <div className="row">
          <button onClick={bringUpSample} disabled={bringingUp}>
            {bringingUp ? "Starting..." : "Bring up local sample target"}
          </button>
          {localTargetStatus?.running && <span className="badge ok">Running at {localTargetStatus.url}</span>}
          {localTargetStatus && !localTargetStatus.running && <span className="badge muted">Not running</span>}
        </div>
      </div>
    </div>
  );
}
