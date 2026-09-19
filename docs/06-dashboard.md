# Phase 6 — Dashboard (Web UI)

## Goal

Provide a web dashboard that lets someone operate Hackbox entirely from the browser: enter a target address, start a run, watch it live, and view the report once it's done — no CLI required.

## Depends on

Phases 1 through 5

## Scope

### In scope

- A target-setup view with an address input and local-only validation feedback
- A run-control view that starts a combined Daytona+Nosana run with one action
- A live-monitoring view showing scan progress and load-test metrics as they happen
- A report viewer for a completed (or aborted) run, plus a history/audit view of past runs

### Out of scope

- Any logic for scanning, load testing, reporting, or validation itself — the dashboard only calls the orchestrator's API (Phase 2) and renders what it returns

## Views

**Target setup.** An input field for the address to test, validated both as the user types and again on submission, restricted to local/private addresses only; a clear, specific error when a public/external address is entered (reflecting the legal-safety requirement, not a generic "invalid input" message); a button to bring up the bundled local sample target for anyone who doesn't already have a local app running; and a live status indicator showing whether the currently entered address is actually reachable before a run is allowed to start.

**Run control.** A single "run test" action that starts one combined run (matching the requirement that Daytona and Nosana are always used together — there is no separate "scan only" or "load test only" button). The currently active scope limits (max RPS, max duration, abort thresholds) are shown read-only, with a note that they can be adjusted through the scope configuration.

**Live monitor.** Progress through the scan phase (current check, findings discovered so far) followed by progress through the load-test phase (live RPS, error rate, and latency, updating in real time), plus a clearly visible kill-switch status indicator that shows if and why a run was aborted.

**Report viewer.** Once a run reaches a terminal state, its report renders inline — findings listed by severity with color coding, load-test charts, and a way to download the Markdown or PDF version. A history list lets the user reopen the report for any past run.

**Audit log viewer.** A searchable, filterable table of every past run (target, time, outcome, findings count, traffic volume), sourced from the Phase 5 audit log.

## Explicit must-have requirements

Two requirements were called out directly and must be treated as first-class, non-negotiable parts of this phase:

- A field to enter the address of the site to test.
- The ability to view the report once the test has finished.

## Definition of done

- [ ] From the browser alone, a user can enter a local address (or bring up the bundled sample target), start a run, watch its live status, and view or download the final report — without touching the CLI.
- [ ] Submitting a non-local address in the target field is rejected in the UI with a clear, specific reason, before any run is created.
- [ ] The live-monitoring view visibly reflects a kill-switch abort when one occurs, rather than appearing to hang or silently stop.
- [ ] The audit log view lists every past run, including failed and aborted ones.

## Risks / open questions

- Whether the live view needs a persistent connection (a full duplex channel) or periodic polling/SSE is enough depends on how frequently metrics need to refresh to feel "live" — to be settled once the Phase 2 event stream is in place and its update frequency is known.
