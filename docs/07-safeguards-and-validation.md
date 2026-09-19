# Phase 7 — Safeguards Hardening & End-to-End Validation

## Goal

Before treating Hackbox as usable, verify that every safety, legal, and ethical constraint from the earlier phases actually holds under adversarial and edge-case conditions, not just in the happy path.

## Depends on

Phases 1 through 6

## Scope

### In scope

- Verifying local-only enforcement at every entry point, including bypass attempts
- Verifying tunnel security (token handling, expiry, guaranteed teardown)
- End-to-end verification of the kill-switch and traffic-ceiling behavior under real conditions
- Verifying secret/API-key handling
- Verifying audit log immutability
- A release checklist

### Out of scope

- Building new features — this phase only exercises and hardens what phases 1-6 already built

## Local-only enforcement

Every entry point that can lead to a run being created or a job being dispatched — the dashboard's API, the CLI, the orchestrator's run-creation path, and the point right before a Nosana job is actually submitted — must independently reject a non-local address, not rely on an earlier layer having already checked it. This must specifically include a DNS-rebinding scenario: a hostname that resolves to a local/private address at validation time but could resolve differently by the time a job runs, which is why re-validation immediately before dispatch (not just once, at the start of a run) matters. It must also include straightforward bypass attempts such as alternate IP encodings, redirects from a local address to a public one, and vice versa.

## Tunnel security

Confirm that a tunnel's public URL cannot be guessed or enumerated in practice, that requests without the correct access token are rejected, that the token and URL stop working once the tunnel is closed, and — critically — that closure actually happens on every exit path: normal completion, a failure partway through, a kill-switch abort, and an unexpected process crash or termination signal. An orphaned tunnel left open after a crash is treated as a serious defect, not a minor cleanup issue.

## Kill-switch and traffic ceiling

Beyond the per-module checks already defined in phases 3 and 4, this phase runs full end-to-end scenarios: a run configured with deliberately strict thresholds must actually abort, actually cancel the underlying Nosana job, and actually close the tunnel, all within an acceptable time window after the threshold is crossed — not just log a warning. Similarly, a run configured with a low traffic ceiling must never exceed it in practice, confirmed by observing real traffic, not only by inspecting the configuration that was requested.

## Secret handling

Confirm that API keys and wallet credentials are read only from local configuration, are never written to logs (including error logs and stack traces), and never end up in anything shipped to the browser as part of the dashboard's frontend bundle. Confirm that the file holding real secrets is excluded from version control.

## Audit log immutability

Confirm that every run, in every terminal state, produces exactly one audit log entry, and that tampering with a past entry directly in storage is detectable through the log's integrity check.

## Release checklist

Before this implementation is considered ready for real use, all of the following should be true: every definition-of-done item in phases 1 through 6 is met; the checks in this document have all been exercised at least once with a real Daytona sandbox and a real Nosana job (not only mocked clients); the README's safeguards section (scope enforcement, traffic ceiling, kill switch, audit log, isolated execution) is accurately reflected by what was actually built; and the local-only restriction plus the future-work note about external domains is clearly communicated wherever the tool is documented for other users.

## Risks / open questions

- Some of these checks (real kill-switch timing, real tunnel teardown under a crash) are inherently about timing and process-lifecycle behavior, which can be flaky in automated tests — consider running them as a manual pre-release checklist in addition to any automated coverage.
