# Phase 1 — Foundations & Local Target Environment

## Goal

Set up the repository scaffolding and configuration, and build the two safety-critical pieces every later phase depends on:

1. **A local-only address validator** — the single source of truth that keeps external domains from ever becoming a target.
2. **A local test target environment** — so users have something to scan/load-test locally.

## Depends on

None (starting phase)

## Scope

### In scope

- Repository structure scaffolding (CLI, orchestrator, dashboard, Daytona integration, Nosana integration, docs)
- Environment configuration schema and loader
- A local-only target validation routine, with unit tests
- A local sample target app (bring-up/tear-down), for demos and for verifying the pipeline end-to-end
- Support for users pointing Hackbox at an app they already have running locally
- A Tunnel Manager component that exposes the local target only for the duration of a run

### Out of scope (later phases or future work)

- The actual scan/load-test logic (phases 3 and 4)
- Support for external third-party domains (future work — not part of this round)

## Functional requirements

### 1. Configuration

The application configuration (loaded from environment variables) must include:

| Setting | Purpose |
|---|---|
| Daytona API key and API URL | Authenticates and addresses the Daytona sandbox service |
| Nosana wallet/key material and RPC URL | Authenticates and addresses the Nosana job network |
| Tunnel provider selection (e.g. cloudflared vs. ngrok) and provider-specific credentials | Controls how the local target is exposed during a run |
| Dashboard port, orchestrator port, local database path | Local service wiring |
| Allowed target CIDR ranges (defaulting to loopback and RFC1918 private ranges) | Drives the local-only validator; can be narrowed but not widened without a deliberate config change |

Configuration files that hold real secrets must be excluded from version control; only an example/template file is committed. Secrets must never be written to logs — the logging layer must redact known secret fields.

### 2. Local-only address validator

A single validation routine must be the sole authority on whether a given address is an acceptable target. It must:

- Parse the given URL and extract the hostname.
- If the hostname is already an IP literal, match it directly against the allowed CIDR ranges.
- If the hostname is a domain name, actually resolve it via DNS and match the **resolved IP** against the allowed ranges — checking the hostname string alone (e.g. rejecting only literal "localhost"-looking names) is not sufficient and must be avoided, since a public domain can be configured to resolve to a private IP (DNS rebinding) or vice versa in a way that changes over time.
- Return a clear pass/fail result plus a reason on failure (invalid URL, not a local address, DNS resolution failed), so calling layers can show a useful error.
- Be called independently at **every** entry point — the dashboard's API layer, the CLI, the orchestrator, and immediately before a Nosana job is dispatched — rather than trusted from a single earlier check. Defense-in-depth here is validated in full in [07-safeguards-and-validation.md](07-safeguards-and-validation.md).

### 3. Local sample target app

- A command to bring up a small, intentionally vulnerable local web app (containing, for example, a reflected XSS endpoint, an overly permissive rate limit, and a toy SQL-injection endpoint) on a local port, and a corresponding command to tear it down.
- Purpose: (a) gives the pipeline something real to exercise end-to-end during development and demos, (b) lets a user try the dashboard immediately even before they have their own local app ready.
- A user's own local app (e.g. a dev server already running on a local port) must be supported the same way — Hackbox does not manage that process, it only validates the address and uses it.

### 4. Tunnel Manager

A component responsible for temporarily exposing a local target address to the outside world for the duration of one run, and handing back a public URL plus a short-lived credential that must accompany any request for it to be forwarded. Requirements:

- Created only when a run starts; closed immediately when the run ends, whether it completes, fails, or is aborted by the kill-switch. Cleanup must be guaranteed even if the orchestrator process crashes or receives a termination signal — no tunnel should be left dangling.
- The public URL must include an unguessable random path component, and a thin local proxy in front of the actual target must reject any request that doesn't carry the current run's auth token — two independent layers of protection, not just one.
- A hard time-to-live must be enforced so a run that runs unexpectedly long cannot keep a tunnel open indefinitely; this ties into the maximum duration enforced in [04-nosana-load-testing.md](04-nosana-load-testing.md).
- The rest of the system (phases 3 and 4) should only ever interact with the tunnel through this component's interface, never with a specific provider's API directly, so the underlying provider can be swapped later.

## Data model

This phase only needs to define the shape of scope/limit configuration; persistence is formalized as part of the Phase 2 database schema.

A **scope configuration** record consists of: an identifier, the list of allowed CIDR ranges, the maximum requests-per-second allowed, the maximum test duration, an error-rate threshold that triggers an abort, and a latency threshold that triggers an abort.

## CLI surface

The CLI should expose, at minimum: a command to initialize local configuration and data directories, a pair of commands to bring up and tear down the local sample target (optionally on a chosen port), and a command to validate the current configuration and scope settings.

## Definition of done

- [ ] Initializing the project creates the expected configuration template and local data directory.
- [ ] The local-only validator is unit-tested against both local addresses (loopback, private-range IPs, `localhost`) which must pass, and non-local addresses (public IPs, public domains, and a DNS-rebinding scenario where a public-looking domain resolves to a private IP) which must fail with a clear reason.
- [ ] Bringing up the local sample target starts a reachable local service that responds successfully to a health check.
- [ ] A tunnel opened by the Tunnel Manager rejects requests that lack the correct token, and becomes unreachable once closed — both verified by an integration test.

## Risks / open questions

- Free quick-tunnel providers issue a new random URL on every run, which is fine for this use case but should be revisited if stability issues arise (a paid tunnel plan would be the fallback).
- Some corporate/firewalled environments may block outbound tunnels entirely. A fully local load-generation fallback (bypassing Nosana) could be considered in the future, but is not part of this round.
