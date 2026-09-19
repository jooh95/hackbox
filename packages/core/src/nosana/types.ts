import type { EventEmitter } from "node:events";
import type { KillSwitch, LoadResult, LoadSample } from "../types.js";

export interface RunLoadTestParams {
  runId: string;
  /** Public URL (already token-guarded) the load generator should hit. */
  targetBaseUrl: string;
  /** Public URL the load generator should POST live samples/final result to. */
  callbackUrl: string;
  targetRps: number;
  rampUpSeconds: number;
  holdSeconds: number;
  rampDownSeconds: number;
  killSwitch: KillSwitch;
  /** Emits "callback" with the raw JSON body every time the tunnel receives a POST from the load generator. */
  callbackEvents: EventEmitter;
  onSample: (sample: LoadSample) => void;
  onProgress: (message: string) => void;
  /** Called once the kill switch fires; the load-test client must actually cancel the job. */
  onAbort: (reason: string) => void;
}

export interface LoadTestClient {
  readonly engine: string;
  runLoadTest(params: RunLoadTestParams): Promise<Omit<LoadResult, "samples">>;
}
