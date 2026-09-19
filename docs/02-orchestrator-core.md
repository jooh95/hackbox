# Phase 2 — Orchestrator Core (Pipeline Engine)

## Goal

Build the central pipeline that owns a single "run" from target validation, through a Daytona scan and a Nosana load test, through live monitoring, to result aggregation and report generation. **Every run always uses both Daytona and Nosana** — there is no mode that runs only one of them.

## Depends on

[01-foundations-and-local-target.md](01-foundations-and-local-target.md)

## Scope

### In scope

- The run lifecycle state machine
- Orchestration logic that invokes the Daytona and Nosana modules (the modules themselves are built in phases 3 and 4)
- A live event stream that the dashboard subscribes to
- The kill-switch hook interface (the actual threshold logic is implemented in Phase 4; this phase only wires it in)
- The local database schema for runs and their configuration
- The REST and streaming API surface used by the dashboard and CLI

### Out of scope

- The scanner and load generator themselves (phases 3 and 4)
- Report rendering (Phase 5)
- The frontend (Phase 6)

## Run lifecycle

A run moves through the following states: pending, validating (re-checking the target address and opening the tunnel), scanning (Daytona, first), load testing (Nosana, second), aggregating, and finally either completed, failed (an exception during validation, scanning, or load testing), or aborted (the kill-switch fired, or the user cancelled it).

**Design decision — scanning and load testing run sequentially, not in parallel.** Running them at the same time would let load-test traffic contaminate the scanner's results (timeouts misread as vulnerabilities) and let scanner traffic distort the load test's error-rate and latency numbers. The default order is scan first, then load test. A parallel or reordered mode could be added later behind a flag, but this round implements only the fixed sequential order.

## Data model

The orchestrator's database needs, at minimum:

- A **runs** table: an identifier, the target URL, the current status, a reference to the scope configuration used, creation/start/finish timestamps, and an abort reason when applicable.
- A **scope configurations** table: an identifier and the allowed CIDR ranges, max RPS, max duration, error-rate abort threshold, and latency abort threshold (as defined in Phase 1).
- A **run events** table: one row per event, referencing a run, with a timestamp, a phase label (scanning, load testing, or system), a severity level, a message, and optional structured data (for example a live RPS/error-rate sample).

Tables for scan results, load results, reports, and the audit log are added in phases 3, 4, and 5 respectively; they should all reference a run by its identifier.

## Kill-switch interface

The orchestrator defines an abstract kill-switch contract: given the current scope limits and a stream of live samples (error rate, p95 latency) for a run, it decides whether the run should be aborted right now. During the load-testing phase, the orchestrator polls this decision on a fixed interval (for example every couple of seconds). The moment it returns true, the orchestrator must, in order: cancel the in-flight Nosana job, close the tunnel immediately, mark the run aborted with a recorded reason, and publish an aborted event to the stream. The concrete threshold logic that implements this contract is defined in [04-nosana-load-testing.md](04-nosana-load-testing.md).

## Live event stream

The dashboard subscribes to a per-run event stream to show live progress. Each event carries a phase, a severity level, a human-readable message, and optionally structured data such as the current RPS/error-rate/latency sample or the reason a kill-switch fired.

## API surface

At minimum, the orchestrator must expose: an endpoint to start a run given a target address (returning a run identifier, or a clear validation error if the address isn't local); an endpoint to fetch a run's current status and summary; a streaming endpoint for live events on a run; an endpoint to cancel a run in progress; and an endpoint to list past runs (used by the dashboard's history and audit views).

Starting a run must re-run the Phase 1 local-only validation internally, even though the dashboard will already have validated the address client-side — the orchestrator never trusts a check performed elsewhere.

## Definition of done

- [ ] Using stand-in Daytona/Nosana clients, a run can be driven from creation through to completion, passing through every expected state transition.
- [ ] Each phase transition is recorded in the run events table and delivered live over the streaming endpoint.
- [ ] Forcing the kill-switch decision to fire causes the run to end in the aborted state with the tunnel closed, verified by an integration test.
- [ ] Attempting to start a run against a non-local address is rejected with a clear error before any job is created.

## Risks / open questions

- Whether Server-Sent Events are sufficient or a full WebSocket connection is needed depends on how frequently the dashboard needs to refresh live numbers — to be revisited in Phase 6.
- Given local resource constraints, only one run should be allowed to execute at a time by default (later runs queue); raising this limit is a possible future extension, not part of this round.
