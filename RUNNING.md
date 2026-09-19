# Running Hackbox

This covers how to start every piece of Hackbox locally: the bundled sample
vulnerable target, the orchestrator API/server, and the web dashboard — plus
how to enable real Daytona and Nosana credentials.

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Every credential in `.env` is optional. With nothing filled in:

- Vulnerability scanning uses a built-in local mock scanner (real HTTP checks
  — missing security headers, cookie flags, a reflected-XSS probe — against
  the tunnel) instead of a real Daytona sandbox running OWASP ZAP.
- Load testing runs the load generator as a local Node process instead of a
  real Nosana job.

This lets the entire pipeline (validation → tunnel → scan → load test → kill
switch → report → audit log) be exercised end-to-end with zero cloud
credentials. Fill in `DAYTONA_API_KEY` and/or `NOSANA_WALLET_PRIVATE_KEY` to
switch each half over to the real service — see "Enabling real Daytona /
Nosana" below.

## 3. Start the three processes

Each runs in its own terminal (or background job).

```bash
# 1. The sample vulnerable target (a small Express app with a deliberately
#    unescaped reflected query param and no security headers), on :4000.
#    Optional — you can point Hackbox at your own local app instead; the
#    dashboard also has a "bring up local sample target" button that starts
#    this same process for you.
npm run dev:local-target

# 2. The orchestrator API (validation, tunnel manager, run pipeline, SQLite
#    persistence, SSE event stream), on :8787.
npm run dev:server

# 3. The dashboard (Vite dev server, proxies /api to :8787), on :5173.
npm run dev:web
```

Then open **http://localhost:5173**.

## 4. Try it from the dashboard

1. **Target Setup** — enter `http://localhost:4000` (or click "Bring up
   local sample target" first if you skipped step 3's first process). Only
   local/private addresses are accepted; anything else is rejected with a
   specific reason.
2. **Run Control** — shows the current scope limits (max RPS, max duration,
   kill-switch thresholds) read-only, then click **Run test**. This starts
   one combined scan + load-test run.
3. **Live Monitor** — streams progress in real time over SSE, including a
   live bar chart of the load test's requests/sec and a kill-switch
   indicator if the run gets aborted.
4. **Report** — once the run finishes (or aborts), view findings by
   severity, load-test metrics, and download the Markdown or PDF report.
5. **Audit Log** — every past run (including failed/aborted ones), with a
   live integrity check of the hash-chained log.

## 5. Or drive it from the CLI

```bash
# Validate an address without starting a run
npm run cli -- validate http://localhost:4000

# View/update the scope (traffic ceiling, kill-switch thresholds)
npm run cli -- scope
npm run cli -- scope --max-rps 20 --max-duration-seconds 20

# Run the full pipeline and block until it finishes
npm run cli -- run --target http://localhost:4000

# Report paths / regenerate the PDF
npm run cli -- report --run-id <run-id> --pdf

# List the audit log and verify its hash chain
npm run cli -- audit
```

## Enabling real Daytona / Nosana

### Daytona (vulnerability scanning)

1. Get an API key from the [Daytona dashboard](https://app.daytona.io/dashboard).
2. Set `DAYTONA_API_KEY` in `.env`.
3. Restart the server (`npm run dev:server`).

**Known limitation:** Daytona enforces [tier-based network
restrictions](https://www.daytona.io/docs/en/network-limits/). Accounts on
Tier 1/2 cannot make outbound network calls from a sandbox to anything
outside a small allowlist of "essential services" (GitHub, npm, PyPI) — which
means a sandbox on those tiers **cannot reach the tunnel to the target at
all**, and every real scan will fail with a network error. This is an
account-level restriction on Daytona's side, not something this project's
code can work around. If your account is Tier 1/2, either upgrade (Daytona's
dashboard/billing) or keep `DAYTONA_API_KEY` empty to keep using the mock
scanner.

### Nosana (distributed load testing)

Two integration paths are supported, auto-selected by the shape of
`NOSANA_WALLET_PRIVATE_KEY`:

- **A Nosana API key** (starts with `nos_`, from
  [dashboard.nosana.com](https://dashboard.nosana.com) → Account → API
  Keys) — spends the account's **Nosana Credits** via `api.nosana.com`. No
  separate wallet funding needed. This is the path this project actually
  verified end-to-end with a real deployment and a real worker node.
  - Nosana currently has no CPU-only market, so the load generator is posted
    to a cheap GPU market (`NOSANA_MARKET`, defaults to the cheapest premium
    market) without requesting GPU access — it just pays that market's rate.
  - **Credit-paid jobs are only allowed on *premium* markets** (community
    markets reject credit payment) and **must** request a minimum 3600s (60
    minute) timeout regardless of how long the actual test runs — Hackbox
    always requests 60 minutes and then stops the deployment itself the
    moment the load generator's own script finishes, so the extra reserved
    time isn't 60 minutes of billed usage, just the cap.
- **A raw Solana wallet keypair** (a path to a keypair JSON file, or the
  JSON array contents of one, e.g. from `~/.nosana/nosana_key.json`) — posts
  directly to the on-chain Nosana Jobs program via the `nosana` CLI. Needs a
  wallet funded with SOL (fees) and NOS (job price), plus `NOSANA_MARKET`
  set to a market slug/address. This path is implemented but was not
  exercised with a funded wallet in verification — the API-key path above is
  the one confirmed working live.

Leave `NOSANA_WALLET_PRIVATE_KEY` empty to keep using the local
load-generator-as-a-process fallback.

## Notes

- `cloudflared` must be installed (`brew install cloudflared`) — it's what
  opens the ephemeral, token-authenticated tunnel to your local target.
- All data lives in `./data` (SQLite DB, raw scan reports) and `./reports`
  (generated Markdown/PDF reports), both gitignored.
- PDF export shells out to a locally installed Chrome/Chromium via
  `puppeteer-core` (no bundled download) — set `HACKBOX_CHROME_PATH` if it's
  not at the default install location.
