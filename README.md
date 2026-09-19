# Hackbox

**Hackbox** is an internal security testing platform that combines [Daytona](https://www.daytona.io)'s isolated execution sandboxes with [Nosana](https://nosana.io)'s distributed compute network to find bugs/vulnerabilities and run load (stress) tests against websites that the requesting user owns or manages.

It is designed as an internal tool for a single team/individual — not a public multi-tenant service that lets other users run tests against arbitrary third-party sites.

---

## ⚠️ Required before use — Authorization & Scope

Hackbox must only be run against targets that have a **written authorization record**. Load and DDoS-resilience testing in particular can cause real outages on the target infrastructure, so the following must be documented and kept on file before any run:

| Field | Description |
|---|---|
| Target scope | Domain(s) / IP range(s) / subdomain allowlist under test |
| Requester | The user who requested the test (the target site's owner, or someone delegated by the owner) |
| Authorization window | Start/end date-time during which testing is permitted |
| Allowed test types | Vulnerability scan / load test / DDoS-resilience test, etc. — explicitly approved items |
| Traffic limits | Max concurrent connections, requests per second (RPS), duration |
| Emergency contact | Someone on the target side who can be reached immediately if something breaks |
| Stop condition | Pre-agreed abort criteria (error rate, latency, etc.) |

This information is recorded in `scope.yaml` (or an internal ticketing system), and the Hackbox orchestrator is configured to **refuse to run against any target that has no authorization record** (see [Safeguards](#safeguards) below).

---

## Architecture

```
                          ┌─────────────────────┐
   Requester approval/scope ─▶│   Hackbox Orchestrator │
                          └──────────┬───────────┘
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐     ┌──────────────────┐
    │  Daytona Sandbox  │    │  Nosana Job Pool  │     │   Report / Audit   │
    │ (isolated runtime) │    │ (distributed load  │     │  (result rollup /  │
    │                    │    │      workers)      │     │       logs)        │
    └─────────────────┘    └─────────────────┘     └──────────────────┘
             │                       │
     Scanner · fuzzer · PoC     Large-scale traffic simulation
     execution (reproducible,   (geographically distributed nodes)
     clean per run)
```

- **Daytona**: Runs vulnerability scanners, fuzzers, and PoC-verification code in a fresh, isolated sandbox on every run. Because the environment is reset each time, results are reproducible and isolated from the host and from other test jobs.
- **Nosana**: Deploys load-testing workers as jobs across Nosana's distributed compute nodes, generating traffic concurrently from multiple nodes/regions to approximate real-world traffic spikes for load and resilience testing. Total traffic volume and concurrency are capped by the orchestrator to the limits declared in the scope.
- **Orchestrator**: Manages the full pipeline — scope validation → Daytona/Nosana job creation → execution monitoring → result aggregation → report generation.

---

## Key Features

1. **Vulnerability scanning module**
   - Automated scanning based on the OWASP Top 10 (injection, auth/session management, access control, SSRF, etc.)
   - Findings are classified by CVSS score and included in the report

2. **Load / resilience testing module**
   - Ramp-up tests that gradually increase traffic to a target RPS / concurrent-connection count
   - DDoS-resilience testing within agreed limits (to verify rate limiter, WAF, and autoscaling behavior)
   - Real-time error-rate/latency monitoring with automatic abort (kill switch) once a pre-agreed stop condition is reached

3. **Reporting & dashboard**
   - Auto-generated reports (Markdown/PDF) covering discovered vulnerabilities, load-test results, and reproduction steps

4. **Audit log**
   - Every run is recorded as an immutable log entry: requester, scope, execution time, and total traffic volume

---

## Installation / Prerequisites

```bash
# Daytona CLI
brew install daytonaio/cli/daytona
daytona login

# Nosana CLI
npm install -g @nosana/cli
nosana config set --wallet <YOUR_SOLANA_WALLET>

# Hackbox
git clone <this-repo>
cd hackbox
cp .env.example .env   # set DAYTONA_API_KEY, NOSANA_WALLET, SLACK_WEBHOOK, etc.
```

## Usage Example

```bash
# 1. Register scope (no command below will run without an authorization record)
hackbox scope add --config ./scope.yaml

# 2. Run a vulnerability scan (executed inside a Daytona sandbox)
hackbox scan --target example.com --scope-id <SCOPE_ID>

# 3. Run a load / DDoS-resilience test (distributed across Nosana workers)
hackbox stress-test --target example.com --scope-id <SCOPE_ID> \
  --max-rps 5000 --duration 10m --ramp-up 2m

# 4. Generate a report
hackbox report --scope-id <SCOPE_ID> --out ./reports/
```

---

## Safeguards

- **Scope enforcement**: Scan/load commands are rejected at execution time for any domain/IP not registered in `scope.yaml`.
- **Traffic ceiling**: `--max-rps` and `--duration` cannot exceed the limits recorded in the approved scope.
- **Kill switch**: Running Nosana jobs are terminated immediately if the target's error rate or latency crosses the pre-agreed threshold.
- **Audit log**: Every run is logged immutably with requester, timestamp, and traffic volume.
- **Isolated execution**: Scanners/fuzzers always run in a fresh Daytona sandbox to prevent result contamination and side effects.

## Responsible Use Policy

- No runs against targets without authorization
- Discovered vulnerabilities are disclosed responsibly, only to the relevant site owner (responsible disclosure)
- No tests beyond the agreed traffic limits
- Scope auto-expires after the test window and requires re-authorization

## License

Internal use only. Distribution is prohibited unless stated otherwise.
