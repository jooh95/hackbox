import express from "express";
import cors from "cors";
import fs from "node:fs";
import {
  config,
  validateLocalTarget,
  getOrCreateDefaultScope,
  upsertScope,
  startRun,
  listRuns,
  getRun,
  requestCancel,
  listEvents,
  runEventBus,
  getScanResultByRun,
  getLoadResultByRun,
  listAuditEntries,
  verifyAuditLog,
  getReportPath,
  generatePdfReport,
} from "@hackbox/core";
import { startLocalTarget, stopLocalTarget, isLocalTargetUp, getLocalTargetUrl } from "./localTargetManager.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/scope", (_req, res) => {
  res.json(getOrCreateDefaultScope());
});

app.put("/api/scope", (req, res) => {
  const updated = upsertScope({ id: "default", ...req.body });
  res.json(updated);
});

app.post("/api/validate-target", async (req, res) => {
  const { address } = req.body ?? {};
  if (typeof address !== "string" || !address.trim()) {
    return res.status(400).json({ ok: false, reason: "Missing 'address'." });
  }
  const scope = getOrCreateDefaultScope();
  const result = await validateLocalTarget(address, scope.allowedCidrs);
  res.json(result);
});

app.post("/api/local-target/start", async (_req, res) => {
  try {
    const result = await startLocalTarget();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/local-target/stop", (_req, res) => {
  stopLocalTarget();
  res.json({ stopped: true });
});

app.get("/api/local-target/status", async (_req, res) => {
  res.json({ running: await isLocalTargetUp(), url: getLocalTargetUrl() });
});

app.post("/api/runs", async (req, res) => {
  const { targetAddress } = req.body ?? {};
  if (typeof targetAddress !== "string" || !targetAddress.trim()) {
    return res.status(400).json({ error: "Missing 'targetAddress'." });
  }
  const scope = getOrCreateDefaultScope();
  // Server-side re-validation even though the dashboard already validated —
  // never trust that an earlier layer already checked (see docs/07).
  const validation = await validateLocalTarget(targetAddress, scope.allowedCidrs);
  if (!validation.ok) {
    return res.status(422).json({ error: validation.reason });
  }
  const run = startRun(targetAddress, scope.id);
  res.status(201).json(run);
});

app.get("/api/runs", (_req, res) => {
  res.json(listRuns());
});

app.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({
    run,
    scan: getScanResultByRun(run.id),
    load: getLoadResultByRun(run.id),
  });
});

app.get("/api/runs/:id/events", (req, res) => {
  const runId = req.params.id;
  if (!getRun(runId)) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");

  for (const event of listEvents(runId)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const onEvent = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  runEventBus.on(runId, onEvent);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    runEventBus.off(runId, onEvent);
  });
});

app.post("/api/runs/:id/cancel", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  requestCancel(req.params.id);
  res.json({ cancelRequested: true });
});

app.get("/api/runs/:id/report.md", (req, res) => {
  const filePath = getReportPath(req.params.id, "md");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Report not available yet" });
  res.type("text/markdown").send(fs.readFileSync(filePath, "utf8"));
});

app.get("/api/runs/:id/report.pdf", async (req, res) => {
  try {
    const filePath = getReportPath(req.params.id, "pdf");
    if (!fs.existsSync(filePath)) {
      await generatePdfReport(req.params.id);
    }
    res.type("application/pdf").sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/audit", (_req, res) => {
  res.json({ entries: listAuditEntries(), verification: verifyAuditLog() });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const port = config.server.port();
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Hackbox orchestrator API listening on http://localhost:${port}`);
});
