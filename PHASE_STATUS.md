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

## Phase 2: Blast Radius — verified (2026-10-24)

Branch `phase-2-blast-radius`. The verified code is commit `54b2c3a`; this status file and docs are committed on top of it. Remote: `github.com/Invinciblx777/faultline` (private).

Environment: Fedora Linux 44, Node.js 24.22.0, Podman 5.8.9, PostgreSQL 17, MinIO (Chainguard), Playwright 1.64.1, Chromium 156.0.8078.4 (headless shell, sandbox on).

### Features

| # | Feature | Status | Where |
|---|---|---|---|
| 1 | Journeys | Done | `packages/shared/src/journey.ts` (`faultline.journey/v1`). Immutable versions in a lineage. Structured editor plus JSON mode at `/projects/[id]/journeys`. The journey snapshot is stored on every analysis |
| 2 | Network dependency discovery | Done | `discoverDependencies` groups real traffic from the baseline and calibration runs into third-party origins, first-party endpoints, and first-party resources. Stores which steps requested each group |
| 3 | Fault scenarios A–E | Done | A unavailable (abort, connection refused). B injected 500/503 for first-party GET/HEAD APIs, labeled. C per-request delay. D online → offline after the first page. E 360×740 viewport with overflow and off-screen checks |
| 4 | Blast Radius Map | Done | `/scans/[id]/blast-radius`. Experiments on the left, journey steps on the right. Links show steps broken or degraded and steps that requested the dependency. Filters by verdict and origin, detail drawer. Verdicts use icon and text, not color alone |
| 5 | Reality Split 2.0 | Done | Side by side, seam, overlay with opacity, and pixel diff. Shows the calibration ratio and the derived threshold |
| 6 | Causal evidence timeline | Done | Injected fault, then new page reactions (excluding events also seen in the baseline), then the first failed check. Full event list links request ids and step anchors. Labeled as time order, not proof of cause |
| 7 | Regression test export | Done | `generateRegressionTest` writes a standalone `@playwright/test` file. The worker runs it with Playwright Test through the egress guard. Download at `/api/experiments/[id]/regression-test` |
| 8 | UI routes | Done | Configure journey, select faults, launch, live progress, map, dependency drill-down, split, timeline, download, `/experiments` findings history, bottom nav item |
| 9 | Security and reliability | Done | Allowlist enforced at launch and execution. Non-GET/HEAD requests blocked unless allowed. Password fields never filled. No headers, cookies, or bodies stored. One active analysis per project, global cap, advisory lock. Analysis time budget and 1 h job expiry. Ownership-checked heartbeat. Interrupted analyses closed out with evidence kept |
| 10 | Real validation on :4600 | Done | See "Verified scenarios" |

### Gates (final code, `54b2c3a`)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 172 passed: shared 106, db 5, web 22, worker 39 |
| `pnpm build` | exit 0 (Next.js production build, worker bundle) |
| `pnpm test:e2e` | 13 passed (59.7 s), including the full Blast Radius flow in real Chromium |

New tests:

- **shared:** journey schema, locator and path safety, dependency grouping, experiment planning, every verdict rule, reproducibility, regression test generation.
- **worker, real Chromium:**
  - Journey execution and timing against the storefront.
  - Dependency discovery.
  - Mutation blocking.
  - Calibration variability.
  - Every fault A–E with its verdict.
  - Password-field refusal.
  - Full analysis lifecycle through PostgreSQL, MinIO, and pg-boss, with artifact hash checks.
  - A generated test fails on the storefront and passes on a test-only fixed copy.
  - Interrupted-analysis close-out.
- **web:** journey versioning and validation; analysis authorization, foreign journeys, allowlist removal, per-project and global caps under concurrent launches, enqueue failure, form parsing; the page-scan path refuses blast-radius configs.
- **E2E:** journey via JSON editor, then launch, completion, map, drawer, experiment page (both screenshots, pixel diff, injected 503, console error, validated test), test download, findings filter, analysis export, and unauthenticated 401s.

### Verified scenarios (live stack on :3000 with the `phase2-demo` operator)

Journey "Buy a backpack" v1, 8 steps (4 assertions, a 2 s budget on the order total, one offline expectation), against `http://localhost:4600/shop/`. Configuration: all three faults, offline, narrow viewport, at most 8 dependency experiments, confirmation on.

The analysis completed in 1 min 52 s. 7 dependencies were observed; 13 candidates were skipped (experiment limit) with reasons. Calibration: 0 of 1,663,788 pixels differed, so the threshold is the 1% floor.

| Experiment | Verdict | Evidence |
|---|---|---|
| API error → `GET /api/catalog` | BROKEN, reproduced | Step 2 never saw "Trail Backpack"; steps 3–8 not reached. Regression test fails against the site as expected |
| API error → `GET /api/inventory` | BROKEN, reproduced | Same. Inventory is fetched with `Promise.all` alongside the catalog. Console error "Storefront failed to load: /api/inventory responded 503". Test fails as expected |
| API error → `GET /api/recommendations` | RESILIENT | Fallback text shown; all 4 assertions held |
| API error → `GET /api/shipping-quote` | BROKEN, reproduced | Step 7 (order total) failed and step 8 failed, because the page shows an error message instead of a total. Test fails as expected |
| Unavailable → `localhost:4601` (third-party partner) | RESILIENT | 2 requests aborted; reviews widget falls back |
| Unavailable → `/shop/shop.css` | RESILIENT | Unstyled but functional |
| Unavailable → `/shop/shop.js` | BROKEN, reproduced | No products render. Test fails as expected |
| Unavailable → `GET /api/catalog` | BROKEN, reproduced | As above. Test fails as expected |
| Online → offline | DEGRADED, reproduced | The shipping quote fails offline and the offline expectation ("You are offline") is not met. Test fails as expected |
| 360×740 viewport | RESILIENT | No horizontal overflow; controls on screen |

Further checks:

- **Generated test passes once the app is fixed.** In the worker test, the inventory regression test fails against the storefront and passes against a fixture that tolerates the missing inventory (`Promise.allSettled`).
- **Worker killed mid-analysis.** `SIGKILL` during experiment 1 of analysis `07698884…`; the worker was then restarted. The stale sweep marked it `failed / worker_interrupted`. The running execution and experiment became failed and 7 pending experiments became skipped. Baseline and calibration evidence was kept.
- **Full restart.** Web and worker were stopped and the Postgres and MinIO containers restarted, then the services were started again. The completed analysis page rendered and 20 screenshot and diff artifacts were re-downloaded with matching SHA-256. All 6 regression tests downloaded.
- **Mobile.** At iPhone 15 Pro Max size (Chromium emulation), the analysis, experiment, and findings pages have 0 px horizontal overflow.

### Artifacts produced per analysis

- Final screenshot per run.
- Screenshot at the failing step.
- Pixel-diff PNG per experiment and for calibration.
- Sanitized network log.
- Step results with timing.
- Evidence events.
- Regression test source with SHA-256 and validation output.
- `faultline.analysis/v1` JSON export.

### Defects found and fixed during Phase 2 verification

- **Injected responses stayed `pending`** when the page never read the body. They are now settled when delivered.
- **Imported journey JSON without `timeoutMs` serialized `NaN`.** Caught by E2E and fixed.
- **The fault sequence listed baseline noise.** Safety blocks and console lines also present in the baseline appeared as reactions to the fault. They are now excluded.
- **Offline and narrow-viewport experiments showed a meaningless "requests acted on" count.** Removed.
- **Experiments skipped after an interruption** said "before this step finished". They now say they never started.

### Limitations (honest list)

- **Discovery scope.** Discovery covers only what the journey requested in two runs; it is not exhaustive coverage of the site. The request log is capped at 600 entries per run.
- **HTTP error injection** applies only to first-party GET/HEAD endpoints.
- **Latency** is a per-request hold, not bandwidth or 3G emulation.
- **Offline** is Playwright context emulation. Without offline expectations, an offline run is recorded but never called broken.
- **Narrow viewport** is Chromium emulation, not Safari or a physical phone. Only Chromium is used.
- **Reality Split** compares final screenshots only; step screenshots exist only at the failing step. Pixels outside the overlap of differently sized pages count as changed.
- **Causal timeline** shows order in time; it does not prove cause. Verdicts come from baseline-versus-experiment rules.
- **Regression tests** are validated for at most 6 findings per analysis. They replay only steps that were stable in both normal runs and need `FAULTLINE_TARGET_URL` and `@playwright/test` to run.
- **Throughput.** Worker concurrency is 1 by default, so a running analysis delays page scans. One active analysis per project.
- **Journey editor.** No recorder: locators are entered by hand. `fill` values are stored in plain text.
- **Map links** are drawn on wide screens only; on phones each card lists its affected steps.
- **Carried over from Phase 1:** no data retention job, no CSP on app pages, per-process login throttling.

### Incomplete criteria

None of the ten Phase 2 features is missing. Partial points are covered by the limitations above (map links on phones, step-level visual comparison).

### Demo reproduction

```bash
podman-compose up -d && pnpm db:migrate
pnpm reference-target                   # :4600 storefront at /shop/, :4601 partner
pnpm build && pnpm start:worker         # separate terminal
pnpm start:web                          # separate terminal
pnpm operator:create admin
```

`FAULTLINE_SCAN_ALLOWLIST` must include `http://localhost:4600,http://localhost:4601`. Then:

1. Sign in and create a project for `http://localhost:4600`.
2. Open **Journeys → New journey → JSON** and paste a journey like the one in `apps/web/e2e/blast-radius.spec.ts`. Choose **Apply JSON**, then **Save journey**.
3. Choose **Analyze blast radius**. Keep all faults and add offline and small viewport.
4. Launch. Progress is live; the analysis takes about 2 minutes.
5. On the map, select `GET /api/inventory`. Open **Evidence and Reality Split** and use the overlay and pixel diff views.
6. Download the regression test and run it: `FAULTLINE_TARGET_URL=http://localhost:4600 npx playwright test <file>`. It fails until the storefront tolerates the fault.

### What Phase 3 (Devin) needs from this

- **Inputs for a repair request:**
  - The `faultline.analysis/v1` export for one experiment: fault, reasons, affected steps, new errors, redacted network evidence.
  - The validated regression test file. It is executable and fails before a fix.
- **Not built yet:**
  - A real Devin API client (no fake integration exists).
  - Per-project repository linkage and credentials storage.
  - PR creation.
  - A UI to request and track repairs.
- **Verification:** run the same regression test (and a rerun of the same experiment) against the patched deployment. `RepairRequest.verificationScanId` already links an independent rerun. "Passes after fix" is proven to work by the worker test that runs the generated test against a fixed storefront. Only that rerun's evidence may mark a repair verified.
- **Allowlist:** the repaired preview deployment's origin must be added to the allowlist before it can be verified.
