import type { Finding, ScanResult } from "../types.js";

export interface RunScanParams {
  runId: string;
  /** Public URL (already token-guarded by the tunnel) the scanner should crawl. */
  targetBaseUrl: string;
  onProgress: (message: string) => void;
}

export interface ScannerClient {
  readonly engine: string;
  runScan(params: RunScanParams): Promise<Omit<ScanResult, "findings"> & { findings: Omit<Finding, "id" | "scanResultId">[] }>;
}
