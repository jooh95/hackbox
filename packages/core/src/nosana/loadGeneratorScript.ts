// Source for the self-contained Node.js load generator that actually runs
// inside the Nosana job's container (and, in local/mock mode, as a plain
// child process on this machine). It has zero npm dependencies — only
// built-in fetch/timers — so it can be dropped into any node:20-alpine
// container via a single inline command with no install step.
//
// Chosen over a k6 script (the option this project's spec left open) because
// it can push live per-second samples straight to Hackbox's own callback
// endpoint, which is what makes the dashboard's "live" chart and the
// kill-switch actually live rather than only visible after the job ends.
export function buildLoadGeneratorScript(): string {
  return String.raw`
const TARGET_URL = process.env.TARGET_URL;
const CALLBACK_URL = process.env.CALLBACK_URL;
const TARGET_RPS = Number(process.env.TARGET_RPS || "10");
const RAMP_UP_SECONDS = Number(process.env.RAMP_UP_SECONDS || "10");
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS || "20");
const RAMP_DOWN_SECONDS = Number(process.env.RAMP_DOWN_SECONDS || "5");

function rpsAtSecond(second) {
  if (second < RAMP_UP_SECONDS) {
    return Math.max(1, Math.round((TARGET_RPS * (second + 1)) / RAMP_UP_SECONDS));
  }
  if (second < RAMP_UP_SECONDS + HOLD_SECONDS) {
    return TARGET_RPS;
  }
  const intoRampDown = second - RAMP_UP_SECONDS - HOLD_SECONDS;
  const remaining = Math.max(0, RAMP_DOWN_SECONDS - intoRampDown);
  return Math.max(1, Math.round((TARGET_RPS * remaining) / Math.max(1, RAMP_DOWN_SECONDS)));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function postJson(url, body) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("callback post failed:", err && err.message);
  }
}

async function fireOne() {
  const start = Date.now();
  try {
    const res = await fetch(TARGET_URL, { method: "GET" });
    await res.arrayBuffer().catch(() => {});
    return { ok: res.status < 500, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function runSecond(second) {
  const rps = rpsAtSecond(second);
  const interval = 1000 / rps;
  const results = [];
  const promises = [];
  for (let i = 0; i < rps; i++) {
    promises.push(
      new Promise((resolve) => {
        setTimeout(() => {
          fireOne().then((r) => {
            results.push(r);
            resolve();
          });
        }, i * interval);
      })
    );
  }
  await Promise.all(promises);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok).length;
  const sample = {
    type: "sample",
    ts: new Date().toISOString(),
    second,
    rps: results.length,
    errorRate: results.length ? errors / results.length : 0,
    p95LatencyMs: percentile(latencies, 95),
  };
  return sample;
}

async function main() {
  const totalSeconds = RAMP_UP_SECONDS + HOLD_SECONDS + RAMP_DOWN_SECONDS;
  const allSamples = [];
  console.log(
    "hackbox load generator starting: target=" + TARGET_URL + " rps=" + TARGET_RPS + " totalSeconds=" + totalSeconds
  );
  for (let second = 0; second < totalSeconds; second++) {
    const tickStart = Date.now();
    const sample = await runSecond(second);
    allSamples.push(sample);
    await postJson(CALLBACK_URL, sample);
    console.log(JSON.stringify(sample));
    const elapsed = Date.now() - tickStart;
    if (elapsed < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
    }
  }
  const allLatencies = [];
  let totalRequests = 0;
  let totalErrors = 0;
  let peakRps = 0;
  for (const s of allSamples) {
    totalRequests += s.rps;
    totalErrors += Math.round(s.rps * s.errorRate);
    peakRps = Math.max(peakRps, s.rps);
  }
  const final = {
    type: "final",
    totalRequests,
    peakRps,
    overallErrorRate: totalRequests ? totalErrors / totalRequests : 0,
    p50LatencyMs: percentile(
      allSamples.map((s) => s.p95LatencyMs).sort((a, b) => a - b),
      50
    ),
    p95LatencyMs: percentile(
      allSamples.map((s) => s.p95LatencyMs).sort((a, b) => a - b),
      95
    ),
    p99LatencyMs: percentile(
      allSamples.map((s) => s.p95LatencyMs).sort((a, b) => a - b),
      99
    ),
  };
  await postJson(CALLBACK_URL, final);
  console.log("hackbox load generator finished:", JSON.stringify(final));
}

main().catch((err) => {
  console.error("hackbox load generator crashed:", err);
  process.exit(1);
});
`;
}
