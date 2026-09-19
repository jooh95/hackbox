#!/usr/bin/env node
import { Command } from "commander";
import {
  getOrCreateDefaultScope,
  upsertScope,
  validateLocalTarget,
  startRun,
  getRun,
  runEventBus,
  listAuditEntries,
  verifyAuditLog,
  getReportPath,
  generatePdfReport,
  type RunEvent,
} from "@hackbox/core";

const program = new Command();
program.name("hackbox").description("Hackbox CLI — local-target vulnerability scan + load test orchestrator");

program
  .command("scope")
  .description("Show or update the active scope configuration (traffic ceiling, kill-switch thresholds, allowed CIDRs)")
  .option("--max-rps <n>", "max requests/sec allowed for a load test", Number)
  .option("--max-duration-seconds <n>", "max load-test duration in seconds", Number)
  .option("--error-rate-threshold <n>", "kill-switch error-rate threshold (0-1)", Number)
  .option("--p95-latency-threshold-ms <n>", "kill-switch p95 latency threshold in ms", Number)
  .action((opts) => {
    const hasUpdates = Object.values(opts).some((v) => v !== undefined);
    const scope = hasUpdates
      ? upsertScope({
          id: "default",
          maxRps: opts.maxRps,
          maxDurationSeconds: opts.maxDurationSeconds,
          errorRateThreshold: opts.errorRateThreshold,
          p95LatencyThresholdMs: opts.p95LatencyThresholdMs,
        })
      : getOrCreateDefaultScope();
    console.log(JSON.stringify(scope, null, 2));
  });

program
  .command("validate")
  .description("Check whether an address passes the local-only validator without starting a run")
  .argument("<address>", "address to validate")
  .action(async (address: string) => {
    const scope = getOrCreateDefaultScope();
    const result = await validateLocalTarget(address, scope.allowedCidrs);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command("run")
  .description("Run a combined vulnerability scan + load test against a local target (blocks until done)")
  .requiredOption("--target <address>", "local/private address to test")
  .action(async (opts: { target: string }) => {
    const scope = getOrCreateDefaultScope();
    const validation = await validateLocalTarget(opts.target, scope.allowedCidrs);
    if (!validation.ok) {
      console.error(`Rejected: ${validation.reason}`);
      process.exitCode = 1;
      return;
    }
    const run = startRun(opts.target, scope.id);
    console.log(`Started run ${run.id} against ${opts.target}`);

    await new Promise<void>((resolve) => {
      const onEvent = (event: RunEvent) => {
        console.log(`[${event.phase}] ${event.type}: ${event.message}`);
        if (["completed", "failed", "aborted"].includes(event.phase) && event.type.endsWith("finished")) {
          runEventBus.off(run.id, onEvent);
          resolve();
        }
        if (event.type === "run_failed") {
          runEventBus.off(run.id, onEvent);
          resolve();
        }
      };
      runEventBus.on(run.id, onEvent);
    });

    const final = getRun(run.id)!;
    console.log(`\nRun ${final.id} finished with status: ${final.status}`);
    if (final.status === "completed" || final.status === "aborted") {
      console.log(`Report: ${getReportPath(final.id, "md")}`);
    }
    process.exitCode = final.status === "failed" ? 1 : 0;
  });

program
  .command("report")
  .description("Print the path to a run's report, generating the PDF on demand if requested")
  .requiredOption("--run-id <id>", "run id")
  .option("--pdf", "also generate/refresh the PDF export")
  .action(async (opts: { runId: string; pdf?: boolean }) => {
    console.log(`Markdown: ${getReportPath(opts.runId, "md")}`);
    if (opts.pdf) {
      const pdfPath = await generatePdfReport(opts.runId);
      console.log(`PDF: ${pdfPath}`);
    }
  });

program
  .command("audit")
  .description("List the audit log and verify its hash-chain integrity")
  .action(() => {
    const entries = listAuditEntries();
    console.log(JSON.stringify(entries, null, 2));
    const verification = verifyAuditLog();
    console.log(`\nIntegrity check: ${verification.ok ? "OK" : `BROKEN at seq ${verification.brokenAtSeq} (${verification.reason})`}`);
  });

program.parseAsync(process.argv);
