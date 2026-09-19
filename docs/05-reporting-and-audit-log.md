# Phase 5 — Reporting & Audit Log

## Goal

Merge a run's scan result and load result into a single, human-readable report (Markdown, with optional PDF export), viewable from both the dashboard and the CLI, and record every run — regardless of outcome — in an immutable audit log.

## Depends on

[02-orchestrator-core.md](02-orchestrator-core.md), [03-daytona-vulnerability-scanning.md](03-daytona-vulnerability-scanning.md), [04-nosana-load-testing.md](04-nosana-load-testing.md)

## Scope

### In scope

- The unified report's content and structure
- Markdown generation, plus PDF export as a secondary output format
- The audit log's schema and append-only/tamper-evidence guarantee
- The CLI and API surface for retrieving a report

### Out of scope

- Rendering the report inside the dashboard UI itself (Phase 6 consumes what this phase produces)

## Report content

A generated report should read top to bottom as: a short summary (target address, run duration, overall outcome, headline counts); run metadata (when it ran, which scope/limits were in effect); the vulnerability findings from Phase 3, sorted by severity/CVSS score, each with its evidence and reproduction steps; the load/resilience results from Phase 4, including the achieved RPS, error rate, latency percentiles, and whether the kill-switch intervened; a short recommendations section derived from the findings and thresholds crossed; and an appendix with any additional reproduction detail that would clutter the main body.

## Generation and export

The primary output is a Markdown document generated directly from the run's stored scan and load results — it must not require re-running or re-fetching anything from Daytona or Nosana. A PDF version is produced by converting that Markdown through a document conversion tool, offered as a convenience export rather than a separate source of truth. Both the Markdown and, when requested, the PDF are written to a reports location on disk and are retrievable by run identifier, from the CLI as well as from the API the dashboard uses.

## Audit log

Every run — completed, failed, or aborted — must produce exactly one audit log entry once it reaches a terminal state, recording: the run identifier, the target address that was tested, when it started and ended, the traffic volume actually generated, the number of findings by severity, and the final outcome. The log must be append-only: entries are never edited or deleted, and the storage mechanism should make undetected tampering with past entries difficult (for example, by chaining each entry to a hash of the previous one so any retroactive edit is detectable by recomputing the chain).

## Definition of done

- [ ] For a completed run, a Markdown report is generated that includes both the scan findings and the load-test results, without any additional network calls to Daytona or Nosana.
- [ ] A PDF export of the same report can be produced on demand.
- [ ] An audit log entry is created for a run in every terminal state, including failed and aborted runs, not only completed ones.
- [ ] A verification step confirms the audit log's tamper-evidence: modifying a past entry directly in storage is detectable.

## Risks / open questions

- The exact document-conversion tool used for PDF export (and whether it needs to be installed separately) should be pinned down once the Markdown template's formatting needs (tables, charts) are finalized.
