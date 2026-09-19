import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { mapZapRiskToCvss } from "./cvss.js";
import { categorizeFinding } from "./owaspCategory.js";
import type { RunScanParams, ScannerClient } from "./types.js";
import type { Finding, ScanResult } from "../types.js";

/**
 * A local, dependency-free stand-in for the real Daytona/ZAP scanner, used
 * whenever DAYTONA_API_KEY is not configured (HACKBOX_MODE=mock, or no key
 * present). It runs a handful of real HTTP checks directly against the
 * tunnel URL — missing security headers, cookie flags, and a reflected-XSS
 * probe — so the full run pipeline (including a genuinely non-empty finding
 * list) can be exercised end-to-end without a Daytona account.
 */
export class MockScannerClient implements ScannerClient {
  readonly engine = "mock-passive-scanner";

  async runScan(params: RunScanParams): ReturnType<ScannerClient["runScan"]> {
    const { runId, targetBaseUrl, onProgress } = params;
    const startedAt = new Date().toISOString();
    const findings: Omit<Finding, "id" | "scanResultId">[] = [];

    onProgress("[mock scanner] Fetching target root page...");
    const res = await fetch(targetBaseUrl).catch((err) => {
      throw new Error(`Mock scanner could not reach target: ${(err as Error).message}`);
    });
    const body = await res.text();
    const headers = res.headers;

    const headerChecks: Array<{ header: string; title: string }> = [
      { header: "x-content-type-options", title: "X-Content-Type-Options Header Missing" },
      { header: "content-security-policy", title: "Content Security Policy (CSP) Header Not Set" },
      { header: "x-frame-options", title: "Missing Anti-clickjacking Header" },
      { header: "strict-transport-security", title: "Strict-Transport-Security Header Not Set" },
    ];
    for (const check of headerChecks) {
      if (!headers.get(check.header)) {
        const { score, severity } = mapZapRiskToCvss("Low");
        findings.push({
          title: check.title,
          owaspCategory: categorizeFinding(check.title, ""),
          cvssScore: score,
          cvssVector: null,
          severity,
          affectedEndpoint: targetBaseUrl,
          description: `The response did not include the "${check.header}" header.`,
          evidence: `Response headers: ${JSON.stringify(Object.fromEntries(headers.entries()))}`,
          reproductionSteps: `GET ${targetBaseUrl} and inspect response headers for "${check.header}".`,
        });
      }
    }

    const setCookie = headers.get("set-cookie");
    if (setCookie && !/httponly/i.test(setCookie)) {
      const { score, severity } = mapZapRiskToCvss("Low");
      findings.push({
        title: "Cookie No HttpOnly Flag",
        owaspCategory: categorizeFinding("cookie", ""),
        cvssScore: score,
        cvssVector: null,
        severity,
        affectedEndpoint: targetBaseUrl,
        description: "A cookie was set without the HttpOnly flag, making it readable from client-side JavaScript.",
        evidence: setCookie,
        reproductionSteps: `GET ${targetBaseUrl} and inspect the Set-Cookie response header.`,
      });
    }

    onProgress("[mock scanner] Probing common paths for a reflected-XSS pattern...");
    const probe = `<script>alert('hackbox-${crypto.randomBytes(4).toString("hex")}')</script>`;
    // Not a real spider — just tries the root path plus a couple of common
    // parameterized paths, since this stand-in scanner has no crawler.
    const candidatePaths = ["", "/search", "/", "?q="];
    let probeUrl = "";
    let probeBody = "";
    for (const suffix of candidatePaths) {
      const base = targetBaseUrl.endsWith("/") ? targetBaseUrl.slice(0, -1) : targetBaseUrl;
      const url = suffix.startsWith("?")
        ? `${base}${suffix}${encodeURIComponent(probe)}`
        : `${base}${suffix}${suffix.includes("?") ? "&" : "?"}q=${encodeURIComponent(probe)}`;
      try {
        const res = await fetch(url);
        const body = await res.text();
        if (body.includes(probe)) {
          probeUrl = url;
          probeBody = body;
          break;
        }
      } catch {
        // try the next candidate path
      }
    }
    if (probeBody.includes(probe)) {
      const { score, severity } = mapZapRiskToCvss("High");
      findings.push({
        title: "Cross Site Scripting (Reflected)",
        owaspCategory: categorizeFinding("cross site scripting", ""),
        cvssScore: score,
        cvssVector: null,
        severity,
        affectedEndpoint: probeUrl,
        description: "The 'q' query parameter is reflected back into the HTML response without escaping.",
        evidence: probe,
        reproductionSteps: `GET ${probeUrl} and observe the unescaped payload in the response body.`,
      });
    }

    if (body.length === 0) {
      onProgress("[mock scanner] Warning: target returned an empty body.");
    }

    const rawDir = path.join(config.dataDir, "raw-scans");
    fs.mkdirSync(rawDir, { recursive: true });
    const rawReportPath = path.join(rawDir, `${runId}.json`);
    fs.writeFileSync(rawReportPath, JSON.stringify({ engine: this.engine, findings }, null, 2));

    onProgress(`[mock scanner] Scan produced ${findings.length} finding(s).`);
    const scanResult: Omit<ScanResult, "findings"> & { findings: Omit<Finding, "id" | "scanResultId">[] } = {
      id: `scan_${crypto.randomUUID()}`,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      rawReportPath,
      findings,
    };
    return scanResult;
  }
}
