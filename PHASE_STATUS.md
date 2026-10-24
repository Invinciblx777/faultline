# Phase status

## Phase 1: Genesis — complete (2026-10-24)

Verified on Fedora Linux 44 (x86_64), Node.js 24.22.0, pnpm 12.15.0, Podman 5.8.9 + podman-compose 1.6.0, PostgreSQL 17 (alpine), MinIO (Chainguard build), Playwright 1.64.1, Chromium 156.0.8078.4 (headless shell, sandbox on).

### Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Application starts locally | Verified | `pnpm start:web` serves `/api/health` → `{"ok":true}`; `pnpm start:worker` logs Chromium preflight, bucket ready, `worker ready` |
| 2 | Database and artifact storage work | Verified | Migrations applied to `faultline` and `faultline_test`; worker integration tests download each stored screenshot from MinIO and recompute its SHA-256 |
| 3 | A real authorized website can be configured | Verified | Project for `http://localhost:4600` created through the UI; non-allowlisted origin rejected (E2E `rejects projects for origins that are not allowlisted`) |
| 4 | Genuine baseline browser scan | Verified | Real Chromium executions against the reference target and against `https://example.com` (public HTTPS via the egress guard, HTTP 200, title "Example Domain") |
| 5 | Genuine fault-injection scenario | Verified | Stylesheet abort produces a real `RangeError: Invalid array length` only under fault; offline reload produces `net::ERR_INTERNET_DISCONNECTED`; service-worker page is served from cache offline |
| 6 | Screenshots and errors come from those executions | Verified | Events and PNGs are written by the worker during execution; report hashes match served bytes (E2E) |
| 7 | Both executions viewable in Reality Split | Verified | E2E loads both images (`naturalWidth > 0`), toggles the seam view, operates the slider by keyboard; visual inspection at desktop and iPhone 15 Pro Max size |
| 8 | Results survive restart | Verified | Stopped web and worker, restarted the Postgres and MinIO containers, restarted services; the earlier scan's split view loaded both images and both artifact hashes matched |
| 9 | Scan history and report retrieval | Verified | E2E: history lists real scans, scenario/status filters change results; report page renders; JSON export downloads with `faultline.report/v1` |
| 10 | Responsive and usable interface | Verified | Navigation rail on desktop, bottom bar on mobile, no horizontal overflow on mobile (E2E), dark and light themes, visible keyboard focus, reduced-motion respected |
| 11 | Authentication and target restrictions enforced | Verified | Unauthenticated pages redirect, APIs return 401, forged session cookie rejected by DB validation, wrong password rejected; allowlist enforced at project creation, scan creation, and execution; egress guard blocks private, metadata, and non-allowlisted loopback destinations |
| 12 | Build, typecheck, meaningful automated tests pass | Verified | `pnpm typecheck`, `pnpm lint`, `pnpm test` (124 tests), `pnpm build`, `pnpm test:e2e` (11 tests) all exit 0 |
| 13 | README has reproducible startup instructions | Done | [README.md](README.md) quick start; every command in it was run in this environment |

### Test inventory

- `packages/shared` (81): URL normalization and obfuscated IPs, allowlist matching and wildcard rules, IPv4/IPv6 classification including mapped/NAT64/6to4, egress decisions, DNS failure handling, redaction, scrypt hashing, scenario schema, report comparison and interpretation.
- `packages/db` (5): exactly-one-claim under concurrency, terminal states are final, queued vs running cancellation, enqueue failure, artifact key safety. Migrations run twice (idempotent).
- `apps/web` (12): project and scan services reject unauthenticated callers, non-allowlisted origins, origin mismatch, removed allowlist entries, malformed scenarios; persist queued scans with job ids; mark scans failed when the queue rejects them; login throttling.
- `apps/worker` (26): real Chromium executions for baseline, resource block, offline (with and without service worker), HTTP 500, navigation timeout, connection refused, console/exception capture with redaction, redirect loops, public-mode refusal, private subresource blocking, out-of-scope redirect, metadata endpoint; egress guard protocol (407 without credentials, CONNECT refusal, transfer budget); full scan lifecycle through PostgreSQL, MinIO, and pg-boss including cancellation, stale-worker recovery, and browser launch failure.
- `apps/web/e2e` (11, Playwright): access control, full resource-failure flow to split/report/export with hash verification, offline flow, history filters, cancellation, mobile layout.

### Implemented

- Projects, scans (resource failure, offline reload), live progress, cancel, run again
- Reality Split (side by side with synced scrolling, draggable/keyboard seam), evidence timelines, conditions and environment
- Scan history per project and across projects with URL search and status/scenario filters
- Report view with "can / cannot be concluded" and JSON export with artifact SHA-256
- Operator auth: CLI account creation, scrypt, DB sessions, throttling
- Egress guard, allowlist, deployment modes, limits, redaction
- Settings page with live worker, storage, and authorization status; future integrations labeled unavailable
- Docs: architecture, security, deployment (with readiness checklist), API, contributing, security policy, MIT license
- Typed future contracts: `AiAnalysisAdapter`, `RepairAgentAdapter`, `RepairRequest`, `VerificationComparison` (no implementations, no UI pretending they exist)

### Defects found and fixed during verification

- Egress guard returned an HTTP 502 for upstream connection failures, which the executor read as an HTTP error. Now marked with a guard header and reported as `navigation_failed` with the socket error code.
- Plain-HTTP traffic through the guard was not counted toward the transfer budget (Node's HTTP parser consumes the socket without `data` events). Now metered on the request and response streams; covered by a test.
- Chromium's own "Failed to load resource" console message for intentionally aborted requests was counted as a fault-only console error. It is now kept as evidence, marked `consequenceOfFaultInjection`, and excluded from error counts and comparisons. Scans recorded before the fix keep their original classification.

### Known limitations (honest list)

- Worker network isolation for public deployments is documented, not provided; `public` mode refuses to start without an explicit acknowledgement.
- Login throttling is per web process; no session-management UI; password reset does not revoke sessions.
- No CSP on the web app's own pages yet.
- Mobile viewport is Chromium emulation, not Safari/WebKit.
- One execution per condition; no automatic reruns for flakiness.
- No data retention job; no container images; no domain-ownership verification.
- Upstream MinIO no longer publishes images; Compose uses Chainguard's MinIO build pinned by digest.
- Fonts are fetched from Google Fonts at build time (`next/font`); offline builds need the font vendored.

### Ready for Phase 2

The scenario schema, execution model, evidence vocabulary, report schema, and integration contracts are in place for: more chaos scenarios (throttling, viewport sweeps, recovery), Fault DNA (events have stable `(execution_id, seq)` ids), AI Detective (adapters consume the exported report and must cite evidence), and Verified Repair (`verificationScanId` links an independent rerun).

## Phase 2 — not started
