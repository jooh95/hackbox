import { config } from "../config.js";
import { DaytonaScannerClient } from "./daytonaScannerClient.js";
import { MockScannerClient } from "./mockScannerClient.js";
import type { ScannerClient } from "./types.js";

export function createScannerClient(): ScannerClient {
  if (config.daytona.apiKey()) {
    return new DaytonaScannerClient();
  }
  return new MockScannerClient();
}

export * from "./types.js";
export * from "./cvss.js";
