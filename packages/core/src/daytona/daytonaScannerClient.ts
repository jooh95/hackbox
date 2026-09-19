import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Daytona } from "@daytona/sdk";
import { config } from "../config.js";
import { mapZapRiskToCvss } from "./cvss.js";
import { categorizeFinding } from "./owaspCategory.js";
import type { RunScanParams, ScannerClient } from "./types.js";
import type { Finding, ScanResult } from "../types.js";

interface ZapAlertInstance {
  uri?: string;
  method?: string;
  param?: string;
  evidence?: string;
}

interface ZapAlert {
  name: string;
  riskcode: string;
  desc?: string;
  solution?: string;
  instances?: ZapAlertInstance[];
}

interface ZapSite {
  "@name"?: string;
  alerts?: ZapAlert[];
}

interface ZapReport {
  site?: ZapSite[];
}

function stripHtml(input: string | undefined): string {
  return (input ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const RISK_LABEL_BY_CODE: Record<string, "High" | "Medium" | "Low" | "Informational"> = {
  "3": "High",
  "2": "Medium",
  "1": "Low",
  "0": "Informational",
};

/**
 * Runs an OWASP ZAP baseline scan inside a fresh Daytona sandbox, per
 * docs/03-daytona-vulnerability-scanning.md. The sandbox is always destroyed
 * afterward (success or failure) so runs never share state.
 */
export class DaytonaScannerClient implements ScannerClient {
  readonly engine = "zap-baseline";

  async runScan(params: RunScanParams): ReturnType<ScannerClient["runScan"]> {
    const { runId, targetBaseUrl, onProgress } = params;
    const startedAt = new Date().toISOString();
    const daytona = new Daytona({ apiKey: config.daytona.apiKey(), apiUrl: config.daytona.apiUrl() });

    onProgress("Creating isolated Daytona sandbox for the scanner...");
    const sandbox = await daytona.create(
      {
        image: "ghcr.io/zaproxy/zaproxy:stable",
        ephemeral: true,
        labels: { hackbox_run: runId },
      },
      { timeout: 180 }
    );

    try {
      onProgress("Sandbox ready. Running ZAP baseline scan...");
      const reportFile = "report.json";
      const command = `mkdir -p /zap/wrk && cd /zap/wrk && zap-baseline.py -t ${JSON.stringify(
        targetBaseUrl
      )} -J ${reportFile} -m 1 -I; echo "HACKBOX_EXIT_CODE=$?"`;

      const result = await sandbox.process.executeCommand(command, "/zap/wrk", undefined, 15 * 60);
      onProgress(`ZAP baseline scan process finished (exit ${result.exitCode}).`);

      // zap-baseline.py itself exits non-zero whenever any WARN/FAIL rule
      // fired, which is the common case, not a scan failure. Only trust the
      // wrapped command's echoed exit code, and only exit code 2 from ZAP
      // means "the scanner itself errored out" per ZAP's own convention.
      const echoedMatch = String(result.result ?? "").match(/HACKBOX_EXIT_CODE=(\d+)/);
      const zapExitCode = echoedMatch ? Number(echoedMatch[1]) : result.exitCode;
      if (zapExitCode === 2) {
        throw new Error(`ZAP baseline scan reported an internal error (exit code 2). Output: ${result.result}`);
      }

      const reportBuffer = await sandbox.fs.downloadFile(`/zap/wrk/${reportFile}`);
      const rawDir = path.join(config.dataDir, "raw-scans");
      fs.mkdirSync(rawDir, { recursive: true });
      const rawReportPath = path.join(rawDir, `${runId}.json`);
      fs.writeFileSync(rawReportPath, reportBuffer);

      const report = JSON.parse(reportBuffer.toString("utf8")) as ZapReport;
      const findings: Omit<Finding, "id" | "scanResultId">[] = [];
      for (const site of report.site ?? []) {
        for (const alert of site.alerts ?? []) {
          const riskLabel = RISK_LABEL_BY_CODE[alert.riskcode] ?? "Informational";
          const { score, severity } = mapZapRiskToCvss(riskLabel);
          const instance = alert.instances?.[0];
          const description = stripHtml(alert.desc);
          findings.push({
            title: alert.name,
            owaspCategory: categorizeFinding(alert.name, description),
            cvssScore: score,
            cvssVector: null,
            severity,
            affectedEndpoint: instance?.uri ?? site["@name"] ?? targetBaseUrl,
            description,
            evidence: instance?.evidence ?? "(no evidence captured by the passive scanner)",
            reproductionSteps: instance
              ? `${instance.method ?? "GET"} ${instance.uri}${instance.param ? ` (param: ${instance.param})` : ""}`
              : `Visit ${targetBaseUrl}`,
          });
        }
      }

      onProgress(`Scan produced ${findings.length} finding(s).`);
      const scanResult: Omit<ScanResult, "findings"> & { findings: Omit<Finding, "id" | "scanResultId">[] } = {
        id: `scan_${crypto.randomUUID()}`,
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        rawReportPath,
        findings,
      };
      return scanResult;
    } finally {
      onProgress("Destroying scanner sandbox...");
      await daytona.delete(sandbox, 60).catch((err) => {
        onProgress(`Warning: failed to destroy sandbox cleanly: ${(err as Error).message}`);
      });
    }
  }
}
