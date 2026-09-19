import fs from "node:fs";
import { marked } from "marked";
import { getReportPath } from "./markdown.js";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function findChromeExecutable(): string | null {
  if (process.env.HACKBOX_CHROME_PATH && fs.existsSync(process.env.HACKBOX_CHROME_PATH)) {
    return process.env.HACKBOX_CHROME_PATH;
  }
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

const PDF_CSS = `
body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; line-height: 1.5; color: #1a1a1a; }
h1, h2, h3 { border-bottom: 1px solid #ddd; padding-bottom: 4px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 12px; }
code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
`;

/**
 * Converts the already-generated Markdown report to PDF, as a convenience
 * export — the Markdown file remains the source of truth. Uses the system's
 * installed Chrome via puppeteer-core (no bundled Chromium download).
 * Per docs/05-reporting-and-audit-log.md this is best-effort: if no Chrome
 * install can be found, this throws a clear error rather than silently
 * failing, and the Markdown report is unaffected either way.
 */
export async function generatePdfReport(runId: string): Promise<string> {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error("No local Chrome/Chromium install found for PDF export. Set HACKBOX_CHROME_PATH or install Google Chrome.");
  }
  const mdPath = getReportPath(runId, "md");
  if (!fs.existsSync(mdPath)) {
    throw new Error(`No Markdown report found for run ${runId} yet.`);
  }
  const markdown = fs.readFileSync(mdPath, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>${await marked.parse(markdown)}</body></html>`;

  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfPath = getReportPath(runId, "pdf");
    await page.pdf({ path: pdfPath, format: "A4", margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" } });
    return pdfPath;
  } finally {
    await browser.close();
  }
}
