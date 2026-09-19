import type { KillSwitch, KillSwitchDecision, KillSwitchSample } from "../types.js";

export interface KillSwitchConfig {
  errorRateThreshold: number;
  p95LatencyThresholdMs: number;
  consecutiveBreachLimit: number;
}

/**
 * Evaluates each live sample against the scope's thresholds. A single sample
 * crossing either threshold counts as a breach; a normal sample resets the
 * count. Only `consecutiveBreachLimit` breaches *in a row* trigger an abort,
 * so a single transient spike doesn't cancel an otherwise-healthy run.
 */
export function createConsecutiveBreachKillSwitch(cfg: KillSwitchConfig): KillSwitch {
  let consecutiveBreaches = 0;

  return {
    evaluate(sample: KillSwitchSample): KillSwitchDecision {
      const breached = sample.errorRate > cfg.errorRateThreshold || sample.p95LatencyMs > cfg.p95LatencyThresholdMs;
      if (!breached) {
        consecutiveBreaches = 0;
        return { shouldAbort: false };
      }
      consecutiveBreaches += 1;
      if (consecutiveBreaches >= cfg.consecutiveBreachLimit) {
        const reasons: string[] = [];
        if (sample.errorRate > cfg.errorRateThreshold) {
          reasons.push(`error rate ${(sample.errorRate * 100).toFixed(1)}% > ${(cfg.errorRateThreshold * 100).toFixed(1)}%`);
        }
        if (sample.p95LatencyMs > cfg.p95LatencyThresholdMs) {
          reasons.push(`p95 latency ${sample.p95LatencyMs.toFixed(0)}ms > ${cfg.p95LatencyThresholdMs}ms`);
        }
        return {
          shouldAbort: true,
          reason: `${consecutiveBreaches} consecutive breaches (${reasons.join(", ")})`,
        };
      }
      return { shouldAbort: false };
    },
    reset() {
      consecutiveBreaches = 0;
    },
  };
}
