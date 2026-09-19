# Phase 4 — Nosana Load / Resilience Testing Module

## Goal

Deploy a load-generation job to Nosana's distributed workers against the validated local target (reached via the tunnel), run a ramp-up load profile, stream live error-rate and latency figures back, and abort immediately (kill-switch) if agreed limits are crossed.

## Depends on

[01-foundations-and-local-target.md](01-foundations-and-local-target.md), [02-orchestrator-core.md](02-orchestrator-core.md)

## Scope

### In scope

- Wrapping Nosana job definition, submission, monitoring, and cancellation
- The load-generator worker's ramp-up profile
- Streaming live metrics into the orchestrator's event stream
- The concrete kill-switch decision logic (implementing Phase 2's interface)
- Enforcing the traffic ceiling from the run's scope configuration (max RPS, max duration)

### Out of scope

- Target validation and tunnel management (Phase 1)
- Vulnerability scanning (Phase 3)

## Why distributed workers are needed for a "local" target

Nosana's workers run on remote nodes, not on the user's own machine, so they need the tunnel's public URL and access token (from Phase 1) injected into the job in order to actually reach the local target. This exposure exists only for the lifetime of the run and is torn down immediately afterward; background and rationale are covered in the design note in [00-overview.md](00-overview.md).

## Load generator

- **Tooling**: a scriptable load-testing tool (such as k6) run as the Nosana job's container command, since it supports staged ramp-up profiles natively and produces a structured summary at the end.
- **Ramp-up profile**: a period ramping traffic up to the target RPS, a hold period at that target, and a short ramp-down. The target RPS and both durations are derived from the run's scope configuration and must always be clamped so they never exceed the configured maximum RPS or maximum duration before the job is even created.

## Kill-switch logic

The concrete kill-switch implementation for this phase evaluates each incoming live sample (roughly every couple of seconds) against the scope's error-rate and latency thresholds. A single sample crossing either threshold counts as a "breach"; a normal sample resets the breach count. Only after a fixed number of **consecutive** breaches (to avoid reacting to a single transient spike) does the kill-switch signal that the run should abort. Once it does, the orchestrator (per its Phase 2 responsibilities) cancels the Nosana job and closes the tunnel — this module is only responsible for the decision, not for carrying it out.

## Data model

A **load result** record references a run and records its start/finish time, the configured target RPS, the actual peak RPS achieved, the overall error rate, p50/p95/p99 latency, whether it was cut short by the kill-switch, and where the raw tool summary is stored. A **load sample** table holds the time series of individual samples (timestamp, RPS, error rate, p95 latency) that were collected during the run, used both for the live dashboard chart and for later analysis.

## Module interface (as called by the orchestrator)

The orchestrator invokes this module with the current run's identifier, the open tunnel handle, the run's scope configuration, the kill-switch implementation to consult, and callbacks for both live samples and progress events. The module submits the Nosana job, polls or streams its output, forwards each parsed sample to the callback and to the kill-switch check, cancels the job early if instructed to abort, and otherwise returns the final load result once the job completes normally.

## Definition of done

- [ ] Running an actual ramp-up load test via a real Nosana job against the Phase 1 local sample target produces a populated time series of samples.
- [ ] Deliberately configuring a low max-RPS limit results in the achieved RPS never exceeding it.
- [ ] Deliberately configuring a very low error-rate threshold causes the kill-switch to fire and the underlying Nosana job to actually be cancelled (confirmed via Nosana's own job status).
- [ ] A kill-switch abort also results in the tunnel being closed correctly, verified together with the Phase 1 tunnel teardown guarantee.

## Risks / open questions

- The geographic distribution and real-world availability of Nosana workers is unknown until a live wallet/network configuration is tested; a job could sit queued for a while if workers are scarce, so a submission timeout policy is needed.
- Whether to use k6 or a smaller custom load-generation script depends on the resulting Nosana job image size and startup latency, to be reassessed once real numbers are available.
