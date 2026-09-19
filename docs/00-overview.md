# Hackbox Implementation Spec — Overview

This directory contains the phase-by-phase implementation specs for Hackbox (the Daytona-sandbox + Nosana-distributed-compute internal security testing platform described in [README.md](../README.md)). Each phase is a standalone document, meant to be implemented in order.

## Key decisions for this implementation round

Compared to the original README (which allows testing arbitrary external domains under owner authorization), this round narrows the scope as follows.

1. **Targets are restricted to local / private-network addresses only.**
   Pointing Hackbox directly at third-party external domains carries legal risk, so this implementation only allows targets on `localhost`, `127.0.0.0/8`, and RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). A local environment for spinning up a target to test against is provided as part of this work. See [01-foundations-and-local-target.md](01-foundations-and-local-target.md).
   Support for authorized external domains (the original README's scope-approval flow) is left as **future work** and is explicitly out of scope here.

2. **Every run uses Daytona and Nosana together.**
   There is no "scan only" or "load test only" mode. A single run always performs (a) a vulnerability scan inside a Daytona sandbox and (b) a load/resilience test via Nosana's distributed workers, and merges the results into one report. See [02-orchestrator-core.md](02-orchestrator-core.md).

3. **The dashboard is a required product feature**, providing:
   - a field to enter the (local) address to test,
   - live progress while a run is in flight, and
   - a report viewer as soon as the run finishes.
   The full flow must work end-to-end from the browser alone, with no CLI required. See [06-dashboard.md](06-dashboard.md).

4. **API keys are supplied by the user.**
   `DAYTONA_API_KEY`, `NOSANA_WALLET` / `NOSANA_RPC_URL`, etc. are injected via environment configuration only, and must never appear in source, commits, logs, or the dashboard's frontend bundle.

> ⚠️ **Important design note — "local" still requires a brief external exposure.**
> Nosana's distributed workers and Daytona's remote sandboxes cannot reach a user's `localhost` directly. So once a run starts, the local target must be exposed briefly through a temporary tunnel so the scan and load test can actually reach it. This is different from attacking a third party (the exposed app is the user's own, and the user is the one exposing it, not the target of someone else's exposure), but the risk isn't zero, so the tunnel must be: short-lived and torn down immediately when the run ends, fails, or is aborted; protected by an unguessable path plus a short-lived auth token; and called out explicitly in the dashboard UI as "this test will briefly expose your local server to the internet." See the Tunnel Manager section of [01-foundations-and-local-target.md](01-foundations-and-local-target.md).

## Assumed technology stack

There is no existing code yet (greenfield), so the specs assume the following stack as a starting default. It can change, but this document should be updated if it does.

- CLI / Orchestrator / API: Node.js + TypeScript
- Dashboard: a single-page React app calling the Orchestrator API over REST + a streaming channel (e.g. Server-Sent Events)
- Local storage: SQLite (runs, scope configuration, reports, audit log)
- Tunnel for exposing the local target: a quick-tunnel provider such as cloudflared (preferred) or ngrok

## Phase list

| Phase | Document | Summary | Depends on |
|---|---|---|---|
| 1 | [01-foundations-and-local-target.md](01-foundations-and-local-target.md) | Repo scaffolding, configuration, local-only address validation, local test target environment, Tunnel Manager | - |
| 2 | [02-orchestrator-core.md](02-orchestrator-core.md) | Run lifecycle, combined Daytona+Nosana pipeline, event stream, kill-switch interface | 1 |
| 3 | [03-daytona-vulnerability-scanning.md](03-daytona-vulnerability-scanning.md) | Daytona-sandboxed vulnerability scanning (OWASP Top 10, CVSS) | 1, 2 |
| 4 | [04-nosana-load-testing.md](04-nosana-load-testing.md) | Nosana-distributed load/resilience testing, traffic ceiling, kill-switch | 1, 2 |
| 5 | [05-reporting-and-audit-log.md](05-reporting-and-audit-log.md) | Unified report generation (Markdown/PDF), immutable audit log | 2, 3, 4 |
| 6 | [06-dashboard.md](06-dashboard.md) | Web dashboard: target address input, run control, live monitoring, report viewer | 1-5 |
| 7 | [07-safeguards-and-validation.md](07-safeguards-and-validation.md) | Local-only enforcement, tunnel security, kill-switch/ceiling E2E validation, release checklist | 1-6 |

## Dependency graph (approximate)

- Phase 1 (Foundations / Local Target) feeds into Phase 2 (Orchestrator Core).
- Phase 2 feeds into both Phase 3 (Daytona Scan) and Phase 4 (Nosana Load).
- Phase 4 feeds into Phase 5 (Reporting / Audit), which feeds into Phase 6 (Dashboard).
- Phase 7 (Safeguards) is cross-cutting and is validated only once phases 1-6 are complete.
