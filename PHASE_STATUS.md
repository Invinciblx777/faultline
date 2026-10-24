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

## Phase 3: Devin Strike — implemented 2026-10-24; live run completed and VERIFIED FIXED in Phase 3.6 (2026-10-25)

Branch `phase-3-devin-strike`, created from `phase-2-blast-radius` at `06e1e72` (tag `phase-2-checkpoint`). Not merged into `main`.

### Status in one paragraph

> Superseded on 2026-10-25: the live Devin session, pull request, and independent verification were completed. See Phase 3.6. The paragraph below describes the state on 2026-10-24.

The repair pipeline is built end to end and verified everywhere FAULTLINE controls the outcome: evidence package and prompt, approval, single-session submission with tag recovery, session and pull request sync, GitHub validation, isolated container builds of exact commits, and independent verdicts with real Chromium. **No real Devin session has been created**, because no `DEVIN_API_KEY` / `DEVIN_ORG_ID` exist in this environment. Devin's HTTP API is exercised only through a stub that follows Devin's published OpenAPI document (`v3`). No Devin pull request exists, so no Devin-authored fix has been verified. Nothing in the UI or the data claims otherwise.

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Phase 2 preserved | Verified | All Phase 2 tests still pass (E2E Blast Radius flow, worker analysis lifecycle); migrations additive (`0002`) |
| Finding → evidence package with checksum | Verified | Live: repair `268eeabb-af9e-4b86-828b-fbcf065f2a88` from finding `5f64dd02`, evidence checksum `2d7ecd17…`; unit tests for content, sanitization, canonical checksum |
| Secrets removed from evidence and prompt | Verified | Unit tests with Devin, GitHub, AWS keys, bearer tokens, cookies, connection strings, query values; prompt fences evidence as untrusted data |
| Explicit operator approval before any spend | Verified | Approval needs approver list, checkbox, matching checksum (service and worker tests). Live: approval disabled with the reason shown, because Devin is not configured |
| One Devin session per approval, recovery without resubmission | Verified against a stub | Worker tests: concurrent submits create one session; timeout leaves `submitting`; restarted worker adopts the session found by tag; gives up after 10 min without creating one |
| Real Devin session | **Blocked** | `DEVIN_API_KEY` and `DEVIN_ORG_ID` not provided |
| Pull request accepted only when GitHub confirms it | Verified against stubbed GitHub responses | Tests reject other repositories, other base branches, short SHAs, same-branch PRs; accepted PR moves the repair to ready for verification |
| Isolated build of an exact commit | Verified (real) | `candidate.test.ts`: real podman container of `Invinciblx777/faultline-reference-shop@6c9ca4c`: label matches SHA, read-only root, uid 65534, `fetch('https://example.com')` from inside fails; busy port and unknown SHA refused |
| Independent verdicts | Verified (real Chromium) | Fixture builds: VERIFIED FIXED, STILL FAILING, REGRESSION DETECTED, INCONCLUSIVE, VERIFICATION BLOCKED (tampered test), interrupted run closed as blocked |
| Verification on real commits in real containers | Verified (real) | Base `6c9ca4c` vs fix `b7cc293` (branch `faultline-verification-fixture`, written by the FAULTLINE developers as a fixture, not by Devin): VERIFIED FIXED; base vs itself: STILL FAILING. The fixture has no PR, so the test answers only the PR lookup locally |
| UI: stepper, launch, live progress, PR card, verification workspace, report | Implemented; partly exercised live | Live walkthrough covered linking, Fix with Devin, awaiting approval, repairs list, settings, mobile layout (no horizontal overflow). Session, PR, and verification panels render from stored rows but were not reached live (they need a Devin session) |
| Build, typecheck, lint, tests | Verified | See gates |

### Gates (code at `d3d17c7`)

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: exit 0.
- `pnpm test` with `GITHUB_TOKEN` taken from `gh auth token` in the process environment (never written to a file): shared 142, db 5, web 27, worker 57 passed (231). Without `GITHUB_TOKEN` the four container tests are skipped with a printed reason.
- `pnpm test:e2e`: 17 passed (adds `e2e/repair.spec.ts`: unauthorized repository refused, shell-like recipe refused, Devin shown as not configured, repair APIs return 401).

### Defects found and fixed during Phase 3 verification

- `GitHubClient` threw synchronously on invalid names instead of rejecting; methods are now `async`.
- Linking a repository redirected to the same page with a hash and left the stale form on screen; the action now revalidates the page.
- The stored owner came from the lower-cased allowlist (`invinciblx777`); FAULTLINE now stores GitHub's canonical `owner/name`. The one request created before the fix (`8b0254a4…`) was cancelled through the UI.
- A test left a queued verification behind that a later test claimed; tests now assert they claim their own run.

### Limitations (honest list)

- No live Devin call has been made. Response shapes come from Devin's OpenAPI document; real behavior (timestamps unit, rate limits, PR reporting latency) is unconfirmed.
- Verification supports Node.js servers without runtime dependencies (`node <entry>`). Other stacks are refused.
- Faults on third-party origins cannot be verified (the candidate build has no third-party counterpart); such repairs are blocked with that reason.
- Verification runs one candidate at a time on fixed loopback ports, which must be on the scan allowlist.
- Operators must link the repository and approve each repair; there is no automatic retry of failed sessions.

### To complete the live Devin run

1. Add `DEVIN_API_KEY` (a `cog_` service-user key) and `DEVIN_ORG_ID` to `.env`; connect Devin's GitHub app to `Invinciblx777/faultline-reference-shop`.
2. Restart web and worker; Settings → Test Devin connection.
3. On repair `268eeabb…`, confirm and approve. The worker creates the session; when Devin opens a PR, select **Verify**.

## Phase 3.5: Live Devin run — v3 connected; Devin's GitHub access missing; awaiting operator approval (2026-10-25)

Checked on 2026-10-25 around 00:00 IST, on branch `phase-3-devin-strike`. No code changed. **No Devin session was created and nothing was approved.**

### Results

| Check | Result | Evidence |
|---|---|---|
| Credentials present | Yes, not printed | `.env` (git-ignored, mode 600) has `DEVIN_API_KEY` (96 characters) and `DEVIN_ORG_ID` (`org-` prefix). The key has the legacy `apk_` prefix, not the v3 service-user prefix `cog_` |
| `GET /v3/self` | **Failed: HTTP 403** | Body: `{"title":"Forbidden","status":403,"detail":"Unauthorized"}` |
| Other v3 reads | **Failed: HTTP 403** | `GET /v3/organizations/{org}/sessions?first=1` and `GET /v3/organizations/{org}/repositories?first=1` |
| Is the key valid at all? | Yes, as a legacy v1 key | Read-only `GET /v1/sessions` → HTTP 200. Conclusion: a working legacy key that API v3 rejects |
| Duplicate-session guard | No FAULTLINE session exists | The v1 list shows one session in the account: `devin-7e00f303…`, tag `agent:devin-rs`, "Analyze Hackathon Project and Tracks", finished, created 2026-10-24T14:04Z. FAULTLINE did not create it, and it has no `faultline` tag |
| Devin's GitHub access to `Invinciblx777/faultline-reference-shop` | **Not verifiable** | Needs v3 `GET /repositories`, which returns 403 with this key. `gh` cannot list GitHub App installations with an OAuth token (HTTP 403 "must authenticate with an access token authorized to a GitHub App") |
| Web and worker restarted with current environment | Done | Both were started before `.env` changed. Restarted at 00:02 IST with `GITHUB_TOKEN` from `gh auth token` in the process environment only. `/api/health` → `{"ok":true}`. Worker log: `devin: unavailable: DEVIN_API_KEY must be a v3 service-user key (prefix cog_)…`, `github: token set`, podman 5.8.9, Chromium preflight ok |
| Original bug unchanged | Yes | `faultline-reference-shop` `main` is still `6c9ca4c`. `public/shop/shop.js:57` still loads catalog and inventory with `Promise.all`. No pull requests exist on the repository |
| Saved repair evidence unchanged | Yes | Repair `268eeabb-af9e-4b86-828b-fbcf065f2a88` is `awaiting_approval`, never approved, with no session, PR, or verdict. Recomputed from the stored rows: evidence checksum (`canonicalJson`) = `2d7ecd17…` (match), prompt SHA-256 match, regression test SHA-256 `c171b00e…` match, and the evidence embeds the same test text. The cancelled request `8b0254a4…` is untouched |
| Fixture branch not presented as Devin's repair | Confirmed | `faultline-verification-fixture` (`b7cc293`, one commit by the repository owner's account changing `public/shop/shop.js`) has no PR. No repair row references `b7cc293` or the branch. The dev database has 0 verification runs. No application source references the fixture; it appears only in worker tests and docs, labeled as developer-written |
| UI ready for approval | **No** | Because the key fails the `cog_` check, the repair page shows "Devin is not configured on this server… Approval is disabled; no session can be created." This is correct: approving would only reach a 403 |

### What is needed

A Devin API v3 **service-user** key (prefix `cog_`) for the organization in `DEVIN_ORG_ID`, created in Devin under Settings → Service users. The service user needs permission to create and view sessions, and Devin's GitHub integration must include `Invinciblx777/faultline-reference-shop`. Then restart web and worker and rerun the checks above. The legacy `apk_` key works only with API v1, which FAULTLINE does not implement.

Not done because of the block: approval, the live Devin session, the GitHub pull request and head commit check, and the independent rerun of the unchanged regression test against the candidate build.

### Rerun with the v3 service-user key (00:13–00:15 IST)

The owner added a `cog_` key at 00:13, but it was saved in `DEVIN_ORG_ID`, overwriting the org ID. `DEVIN_API_KEY` still held the legacy key. A read-only `GET /v3/self` with the `cog_` value returned 200. FAULTLINE then rewrote the two lines in `.env`: `DEVIN_API_KEY` now holds the `cog_` key and `DEVIN_ORG_ID` holds the `org_id` from `/v3/self`. The previous file was backed up outside the repository with mode 600. No value was printed.

| Check | Result | Evidence |
|---|---|---|
| `GET /v3/self` | **Passed: HTTP 200** | `principal_type: service_user`; `org_id` equals `DEVIN_ORG_ID` |
| v3 org reads | Passed | `GET /v3/organizations/{org}/sessions` 200; `GET /v3/organizations/{org}/repositories` 200 |
| Devin's GitHub access to `Invinciblx777/faultline-reference-shop` | **Not granted** | `GET /v3/organizations/{org}/repositories?first=100` and `?filter_name=faultline-reference-shop` both return `items: []`. Devin's Git connections list no repositories |
| Existing sessions in the org (v3) | One, not FAULTLINE's | `7e00f303…`, status `suspended`, no tags, "Analyze Hackathon Project and Tracks" (same session as in the v1 list) |
| Web and worker restarted | Done (00:15 IST) | Worker: `devin: configured`, `github: token set`, podman 5.8.9, Chromium preflight ok. `/api/health` → `{"ok":true}`. Neither log contains a `cog_` or `apk_` string |
| Repair `268eeabb…` unchanged | Yes | Still `awaiting_approval` with no approval, session, or PR, and `updated_at` still 2026-10-24 17:51:10 UTC. Evidence, prompt, and regression-test checksums recomputed again: all match |
| Approval possible in the UI | Yes, for `phase3-demo` only | Devin now counts as configured, so the approval gate is open. `FAULTLINE_REPAIR_APPROVERS=phase3-demo` |
| Stored repository link status | Stale | `source_repositories.devin_status` is still `not_configured` from the 2026-10-24 check. **Recheck** on the project page refreshes it |

**Risk before approving:** FAULTLINE's approval gate does not require Devin's repository access. If the repair is approved before the Devin GitHub app can see the repository, the session spends credits and may be unable to clone the private repository. Grant access in Devin first (Settings → Connections → GitHub). Then confirm that **Recheck** shows Devin as connected.

Not done yet: approval (left to the owner), the live session, PR validation, and the independent verification run.

### Fail-closed repository-access preflight (00:20–00:40 IST)

The risk above is now closed in code. Approval and session creation both require a live check that the v3 key authenticates, belongs to `DEVIN_ORG_ID`, and that Devin's GitHub connection lists the request's exact repository. See the changelog entry for the design.

| Check | Result | Evidence |
|---|---|---|
| Unit and integration tests | **Passed** | `pnpm test`: shared 148, db 5, web 34, worker 55 passed (4 real-container tests skipped: no `GITHUB_TOKEN` in the test shell). New cases: missing repository, key from another organization, refused organization, failed requests (401, 500, 503, network, malformed body), stale/unchecked/failed stored state, relinked project, successful access. In the worker tests, a failed preflight makes no POST (no upload, no session) |
| Typecheck, lint, build | **Passed** | `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| Dev database | Migrated | `pnpm db:migrate` applied `0003` (`source_repositories.devin_checked_at`) |
| Web and worker | Restarted on the new build (00:33 IST) | Worker: `devin: configured`, `github: token set`, podman 5.8.9, Chromium preflight ok. `GITHUB_TOKEN` from `gh auth token` in the process environment only |
| Live recheck for repair `268eeabb…` | **Repository not available** | `GET /v3/self` passed and its `org_id` matches `DEVIN_ORG_ID`. Devin's repository list for the organization does not include `Invinciblx777/faultline-reference-shop`. Result stored with `devin_checked_at` |
| Repair page in the browser (`phase3-demo`) | **Approval disabled** | The checkbox and **Approve and send to Devin** are disabled. The page shows: "Devin cannot use Invinciblx777/faultline-reference-shop: Devin's Git connections for org-… do not list Invinciblx777/faultline-reference-shop…". **Check repository access** completed in about 5 s with the same reason. The script never touched the approval controls |
| Repair `268eeabb…` unchanged | Yes | `awaiting_approval`, not approved, no session, `updated_at` still 2026-10-24 17:51:10 UTC. Evidence and prompt checksums recomputed: match |

**Ready for approval: no.** Grant the Devin GitHub app access to `Invinciblx777/faultline-reference-shop`. Then click **Check repository access** on the repair page. Approval unlocks for 10 minutes after a successful check, and the server checks again when you approve.


## Phase 3.6: Final strike — live Devin repair VERIFIED FIXED (2026-10-25)

### Connection preflight (00:44–00:47 IST)

No code changed. **No Devin session was created and nothing was approved.**

| Check | Result | Evidence |
|---|---|---|
| Branch and processes | Current | `phase-3-devin-strike` at `d8fbd17`, tree clean. Web and worker were started at 00:33 IST on the `d8fbd17` build. Worker log: `devin: configured`, `github: token set`, podman 5.8.9, Chromium preflight ok |
| `GET /v3/self` | **Passed** | `principal_type: service_user`; `org_id` equals `DEVIN_ORG_ID` |
| `checkDevinRepositoryAccess` (unchanged, called live) | **Passed** | `ok: true`, `repoName: Invinciblx777/faultline-reference-shop`, `host: github.com`. The operator granted the Devin GitHub app access after 00:40 IST |
| Stored repository status | Refreshed | **Check repository access** on the repair page (as `phase3-demo`): `source_repositories.devin_status` changed from `error` to `ok` at 19:17:19 UTC. The project is still linked to `Invinciblx777/faultline-reference-shop` |
| Repair `268eeabb…` | Unchanged | `awaiting_approval`, no approval, no session, `updated_at` still 2026-10-24 17:51:10 UTC. Evidence `2d7ecd17…`, prompt `d7296ce4…`, regression test `c171b00e…` recomputed from the stored rows: all match. The evidence embeds the same test text |
| Faulty code still present | Yes | `faultline-reference-shop` `main` = `6c9ca4c`; `public/shop/shop.js:57` uses `Promise.all` for catalog and inventory. No pull requests. The local target served on `:4600` has an identical `shop.js` |
| Original failure reproducible | Yes | The stored regression test (byte-identical apart from a trailing newline; SHA-256 `c171b00e…`) was run with Playwright against `:4600`: **1 failed**, step 2 `getByText('Trail Backpack')` not visible |
| Prompt | Meets the repair contract | Names the exact repository and base commit; asks Devin to reproduce, find the root cause, fix with graceful degradation, keep normal behavior, add tests, never weaken tests, open a PR from a new branch against `main`, never push to `main` or merge, and include `FAULTLINE-Repair: 268eeabb-…`. It contains no reference to the developer fixture (`b7cc293`) or to its fix |
| Approval UI | **Ready** | After the check, the confirmation checkbox is enabled; **Approve and send to Devin** enables once it is ticked. The check script never touched those controls |

Repository-list visibility is not proof that Devin can clone or push. That is only shown by the live session.

`DEVIN_MAX_ACU_LIMIT` is not set, so the session has no ACU cap.

### Live repair run (00:59–01:09 IST)

Every row is from the FAULTLINE database, GitHub, or the Devin API. The full record is [FINAL_VERIFICATION_REPORT.md](FINAL_VERIFICATION_REPORT.md).

| Step | Result | Evidence |
|---|---|---|
| Operator approval | **Done by the operator** | `phase3-demo` approved in the UI at 00:59:36 IST. The repository-access check ran again at approval and in the worker (00:59:41). Nobody approved by script, API, or database edit |
| Devin session | **Created, exactly one** | `60a680e3098142b0b1b2ca8fca9cf27a` (https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a). `GET` on the session via the v3 API returns the same ID, URL, organization, and both FAULTLINE tags. A tag lookup finds one session. 2 screenshots attached. Suspended for inactivity at 01:08:43 after its work was done |
| Pull request | **Confirmed on GitHub** | [PR #1](https://github.com/Invinciblx777/faultline-reference-shop/pull/1): author `app/devin-ai-integration`, base `main` @ `6c9ca4c`, head `devin/1792870305-inventory-503-graceful` @ `b750bd30883778daed7b2fe03011c328694cfcbf`, same repository, open, not merged. The body has `FAULTLINE-Repair: 268eeabb-…`. The worker accepted it at 01:03:46 |
| Code change | Focused | `shop.js` uses `Promise.allSettled`; missing inventory shows "Stock level unavailable" and keeps products purchasable. Adds `e2e/shop.spec.mjs` and a dev-only `@playwright/test`. `test/` is unchanged |
| Repository tests | Not weakened | `node --test` in `node:22-alpine` (no network, read-only, uid 65534): 4/4 on both `6c9ca4c` and `b750bd3`. Devin's new e2e tests: 4/4 on `b750bd3`; on `6c9ca4c` the 2 inventory tests fail and 2 pass |
| Independent verification | **VERIFIED FIXED** | Run `39c125f0-ca3c-4e33-afb5-ae5c03430097`, 59.6 s, podman containers of the exact commits, Chromium 156.0.8078.4. A original normal: passed. B original + fault: failed 2/2. C candidate + fault: passed 2/2. D candidate normal: passed (screenshot byte-identical to A). Regression test SHA-256 `c171b00e…` unchanged |
| Evidence integrity | Match | All 4 verification screenshots downloaded through the authenticated API match their stored SHA-256 and sizes; unauthenticated request → 401 |
| UI loop | Works | Read-only browser walkthrough as `phase3-demo`: blast radius map, finding, Reality Split, repair page (stepper, verified report, session and PR links, before/after screenshots), repairs list. Verdict still shown after reload. No console errors |
| Mobile | Fixed | The repair page overflowed by 53 px at 430 px wide (full SHAs and archive names in the report). Fixed in `d72a39b`; also gave the bottom bar one column per item (it had 4 columns for 5 items). Now 0 px on every page checked |

### Gates (code at `d72a39b`)

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` (with `GITHUB_TOKEN` from `gh auth token` in the environment) | 246 passed: shared 148, db 5, web 34, worker 59 (real-container tests included). Run before `d72a39b`; that commit changes only two web components |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 17 passed (1.1 min) on the `d72a39b` code |

### Not done / limitations

- One live repair verified, for one fault, in Chromium. The other BROKEN findings on the reference shop (catalog, shipping quote, `shop.js` unavailable) are not repaired.
- PR #1 is not merged. That is the repository owner's decision.
- Devin's fix lets out-of-stock items be added to the cart while inventory is down (disclosed in the PR; `/api/orders` has no server-side stock check).
- Credits: FAULTLINE stores the session's `acus_consumed` rounded to an integer (`0`); the exact figure is on the Devin session page.
- No public deployment, no repository visibility change, no submission made.


## Phase 4.1: Judge-ready (2026-10-25, 01:46–03:05 IST)

Branch `feat/verdict-scope-comment` (from `main` at merge `71924ca` of `phase-3-devin-strike`), merged to `main` with a merge commit after the gates below. Phase 4.5 (design system) not started.

### Steps

| Step | Status | Evidence |
|---|---|---|
| 0. Merge Phase 3 into `main` | Done | `71924ca` (merge commit, pushed). Reference-shop PR #1 not merged |
| 1. Verdict scope, agent-stated limitation, credits | Done (`905595c`) | Scope line on the repair report, every verification run, and the PR comment. "Agent-stated limitation" quotes 3 bullets from PR #1's body. `devin_acus_consumed` is `double precision`; the Devin API returns `0` for session `60a680e3…`, so the UI hides the figure and links the session |
| 2. Verdict comment on PR #1 | Done | https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389303315, posted 20:43:04 UTC once; a second call found the marker and did not post. Fallback copy: `docs/PR1_VERDICT_COMMENT.md` |
| 3. Real-app scan | Done | Project `13327180-4c6e-41e1-9b4a-0b445cdb64fb` (`https://www.daluxeofficial.in`), journey `12180c2c…` (6 steps, home → product → cart drawer, GET only). Analyses `004f212e…` (8 experiments), `e24a90ca…` (6), `e9044023…` (4). Results in README; screenshots in `docs/screenshots/real-app/` |
| 4. Stricter journey vs `b750bd3` | Done | Journey v2 `e70ef703…` (step 3 `assertDisabled` on "Add Camp Bottle to cart"). Analysis `76f3b920…`: BROKEN, reproduced; test `dce96fba…` `fails_as_expected`. Cross-check run `24f9f532…`: **STILL FAILING** (candidate under the fault fails step 3, "Received: enabled", 2 of 2; candidate normal passes 9 of 9). Repair verdict unchanged |
| 5. Secrets and public readiness | PUBLIC-READY | gitleaks 8.21.2 over 37 commits: 7 matches, all synthetic fixtures in test files (`packages/shared/test/verdict-report.test.ts:42,54`; `apps/web/test/repair-services.test.ts:131`; `packages/shared/test/integrations.test.ts:4`; `packages/shared/test/repair.test.ts:139`; `apps/worker/test/repair.test.ts:230`; `packages/shared/test/redact-password.test.ts:25`). Only `.env.example` is tracked. Reference shop (4 commits): 0 matches. LICENSE (MIT), SECURITY.md, CONTRIBUTING.md present |
| 6. README in product voice | Done | No banned words (grep). `docs/vision.md` → `docs/ROADMAP.md` |
| 7. Demo insurance | Done | `pnpm demo:preflight` 10 of 10 PASS live; fresh-clone `pnpm quickstart` + `pnpm demo` + scripted analysis (48 s); runbook; backup video `docs/demo/faultline-walkthrough.webm` (156.7 s) |
| 8. Pitch and submission | Done, owner fields open | `HACKATHON_PITCH.md`, `SUBMISSION.md` (participants, form, checklist, and organizer questions left to the owner) |

### Real-app findings (Daluxe Official)

- Main JS bundle (`/_expo/static/js/web/index-3acffe89….js`) unavailable: BROKEN, reproduced in two analyses, 97.38% pixels changed, steps 2–6 fail. Experiment `d0e19ccf-fdfb-4a40-86cb-b1e6087ffc04`; test `cfe9f5ae…` `fails_as_expected`.
- RESILIENT with 0.00% pixel change: CSS unavailable; 5 images unavailable; bundle and CSS slowed by 3 s.
- `http://localhost:8081` (the production bundle requests `/api/supabase-config` there from visitors' browsers): RESILIENT in `004f212e`; INCONCLUSIVE, not reproduced, in `e24a90ca` ("Step 3 (Open a product) … page.goto: Timeout 30000ms exceeded").
- Offline after the first page: INCONCLUSIVE (no offline expectation configured; step 3 fails).
- 360×740 viewport: BROKEN, reproduced, at step 5. Cause: the journey's CSS selector for the cart icon exists only in the desktop layout. A manual Playwright check at 360 px found a cart button at the top right that opens "Your Cart". Its regression test validation ended `error` (runner exceeded 180 000 ms against the live site).
- HTTP-error injection skipped for every dependency (no first-party GET API endpoints in the journey).

### Gates (code at `b1383a0`)

`GITHUB_TOKEN=$(gh auth token)` set; live web stopped during build and E2E.

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` | 257 passed, 0 failed, 0 skipped: shared 158 (8 files), db 5 (1), web 34 (3), worker 60 (7, 354.9 s, includes real podman container verification) |
| `pnpm test:e2e` | 17 passed, 0 failed, 0 skipped (1.1 min) |

### Not done / limitations

- PR #1 is open and not merged. Its verdict comment was not updated with the cross-check.
- The PR comment's screenshots point at `raw.githubusercontent.com/Invinciblx777/faultline/main/docs/screenshots/verification/…`; they render only once this repository is public.
- PR #1's body (written by Devin) contains a Devin attachment URL with a signed token; it becomes visible if the reference-shop repository is made public.
- The 360 px finding needs a mobile-aware journey (a role or test-id target for the cart button) before it says anything about the store.
- Repository visibility unchanged; nothing submitted; no public deployment.

## Phase 4.2: Last mile (2026-10-25, 03:05–03:40 IST)

Branch `fix/last-mile` (from `main` at `b1dd3fc`), merged to `main` with a merge commit after the gates below. Phase 4.5 not started.

| Item | Status | Evidence |
|---|---|---|
| 1. `RULES.md` from another event | Done | `git rm RULES.md` (it described "DevDay Exchange Community Hackathon: Kochi", 10–11 Oct, Codex). References removed from `SUBMISSION.md`, `AGENTS.md`, `.github/pull_request_template.md`, `AI_USAGE.md` header. `SUBMISSION.md` organizer questions cut to six: form URL, public repo, video/length, team name, track, deadline. Its template checklist (Codex, start-from-scratch, 10:00 11 Oct) is removed |
| 2. Daluxe 360 px false red | Done | Journey v2 `2f1fdb64-5997-4d21-b09b-8b8b1aaf04c4` (lineage of `12180c2c…`), saved through `reviseJourney`. Step 5 target `div.r-12vffkv > div.r-18u37iz > div[tabindex="0"].r-usgzl9:last-child`; no role, text, or test id exists on the store's icon buttons (React Native Web divs, no aria-label). Checked by hand in Playwright first: 1 match at 1280 px (x 1196) and 360 px (x 300), click shows "Your Cart" at both. Analysis `83758bb7-4a37-41cf-afdd-b2b73c3f020c` (launched through `createAnalysis`, 03:11:55–03:14:56 IST): 360×740 **RESILIENT** (experiment `921abd8d…`, all 3 assertions pass); main bundle unavailable BROKEN, reproduced, 97.40%, test `fails_as_expected`; `origin http://localhost:8081` unavailable RESILIENT. v1 analyses stay in history |
| 2b. `localhost:8081` label | Done | `developmentEndpointNote` (shared) derives the note from the dependency key and analyzed origin: a public site whose visitors' browsers request a loopback origin. Shown on the Blast Radius card, drawer, and experiment page. README lists it first |
| 3. Second verdict on PR #1 | Done | https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389982815, posted 2026-10-24 21:51:57 UTC. `pnpm repair:comment` gains `--run`, `--title-detail`, `--limitation`; a non-latest run's comment is recorded as a repair event and never replaces the repair's own verdict-comment record. Two later calls found the marker and did not post. PR comments in order: Devin bot, VERIFIED FIXED (`6389303315`), STILL FAILING (`6389982815`). Copy: `docs/PR1_VERDICT_COMMENT_V2.md`. PR not merged |
| 4. Public readiness | Done, operator actions open | `docs/PR1_BODY_CLEAN.md`: PR #1 body with the one Devin `presigned_proxy` image line removed, rest verbatim (0 matches for `presigned` or `token=`). Not applied. Video 20,667,959 bytes (under 25 MB), stays in Git; Release asset after the event. `.gitignore` ignores `.env` and `.env.*` except `.env.example`; `.env.example` holds placeholders only (`change-me`, `change-me-too`), the only tracked env file. Screenshots reviewed for this pass: 03, 04, 07, 08, 09, real-app 01, real-app 02, the new verification PNG: reference-shop data, operator name `phase3-demo`, public store content; no personal data |
| 5. Pitch and runbook | Done | Break: shop, then Daluxe `localhost:8081`. Prove: v1 VERIFIED FIXED, then v2 STILL FAILING and PR tab H |

Defect found and fixed: `pnpm repair:comment --out docs/…` resolved the path against `packages/db` (pnpm's cwd), so the first post succeeded and the write then failed (exit 1). `--out` now resolves against `INIT_CWD`. The idempotency marker kept it to one comment.

### Gates (code on `fix/last-mile`)

`GITHUB_TOKEN=$(gh auth token)` set; live web stopped during build and E2E, then web and worker restarted on the new build.

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 (rerun after the `--out` fix: exit 0) |
| `pnpm lint` | exit 0 (rerun: exit 0) |
| `pnpm build` | exit 0 (rerun: exit 0) |
| `pnpm test` | 260 passed, 0 failed, 0 skipped: shared 161 (9 files), db 5 (1), web 34 (3), worker 60 (7, includes real podman container verification) |
| `pnpm test:e2e` | 17 passed, 0 failed, 0 skipped (1.1 min) |

New tests: `developmentEndpointNote` (2), verdict comment heading qualifier and tested-limitation wording (1), and the worker cross-check test now posts the cross-check's own comment (marker on the run, cross-check journey and test, wrong limitation number refused, second call finds it, repair verdict-comment columns untouched).

`pnpm demo:preflight` after restart: 10 of 10 PASS. Route check: tabs A–E answer locally (storefront 200; app pages 307 to sign-in); Devin session 200; PR #1 404 to an unauthenticated request (private repository). The clicked three-minute route was not timed in this session: it needs the `phase3-demo` sign-in.

### Not done / limitations

- PR #1 body still contains the Devin signed image URL. `docs/PR1_BODY_CLEAN.md` is ready; the operator applies it.
- The `localhost:8081` note on the Blast Radius card is covered by unit tests and typecheck; it was not viewed in a signed-in browser this session.
- The backup video predates this pass: its real-app beat shows analysis `004f212e…`, not the `localhost:8081` note or the 360 px cell.
- `docs/screenshots/real-app/01-blast-radius-map.png` is analysis `004f212e…` (no 360 px cell).
- Repository visibility unchanged; nothing submitted; no public deployment.

## Phase 4.5: Material 3 Expressive interface (2026-10-25, 03:40–04:30 IST)

Milestone branches `ui/m1-tokens`, `ui/m2-primitives`, `ui/m3-blast-split`, `ui/m4-repair-lists`, `ui/m5-closeout`, `ui/m5-closeout-2`, each fast-forwarded into `main` after its gates. Spec: the operator's prompt and `docs/design/reference-android16.png`.

| Milestone | Status | Evidence |
|---|---|---|
| M1 tokens, font, shell | Done (`be93026`) | `tokens.css` generated (DynamicScheme, tonal spot, contrast 0); warm dark surfaces (`surface` `#19120d`). Manrope substitutes for Google Sans Flex (not in repo). Rail 80 px, pill in `secondary-container`, content 1200 px + 24 px padding. `lint:tokens` in `pnpm lint`: 0 hits |
| M2 primitives | Done (`d57a077`) | 16 primitives (the list in the prompt), `/design` showcase in both schemes. Web tests: render tests plus 20 contrast checks (10 pairs × 2 schemes, each ≥ 4.5:1) |
| M3 Blast Radius, Reality Split | Done (`a8fde0c`) | Scallop hero "N of M experiments break the journey" (the prompt said "dependencies"; the count includes conditions such as offline, so "experiments" is accurate). Tiles single column on desktop so the step lines keep working |
| M4 repair, lists, approval | Done (`8e67616`, `709f999`) | Approval keeps the checkbox and the human click; cancel reads "Cancel request" because it cancels the repair request. One verdict comment URL is stored, so one comment row is linked |
| M5 close-out | Done | Screenshots 01, 02, 05, 06 and the 3 under `verification/` inspected: reference-shop and Daluxe public content only, no personal data. UI screenshots refreshed at 1440×900 dark plus `10-blast-radius-mobile.png` at 390×844 (horizontal overflow 0 px). Evidence screenshots 05, 06, `verification/*` untouched. Video re-recorded 04:17 IST: 158.9 s, 22,367,410 bytes, frames at 0:36, 0:50, 1:06, 2:20 inspected |
| Not migrated beyond tokens and shell | Open | Journey builder, scan detail, report, settings (light pass), new-scan and new-analysis forms. `components/ui/button` and `components/ui/surface` are still used by 23 files and stay |

Route timing (scripted, signed in as `phase3-demo` with the stored local test password, not printed; 1440×900, final build): A 0.04 s, B 0.42 s, C 0.42 s, D 0.44 s, E 0.44 s. The `localhost:8081` note renders on the Blast Radius card, the bottom sheet, and the experiment page (1 match each). Tab E lists VERIFIED FIXED before STILL FAILING. F, G, H (GitHub PR, Devin session) not timed: they need the operator's GitHub and Devin sign-in.

### Gates (code on `ui/m5-closeout-2`)

Live web stopped during build, then restarted on the new build.

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` (includes `lint:tokens`) | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` | exit 0 without `GITHUB_TOKEN`: 287 passed, 4 skipped (worker container tests). Worker rerun with `GITHUB_TOKEN=$(gh auth token)`: 60 passed, 0 skipped. Total 291 passed (shared 161, db 5, web 65, worker 60), 0 failed |
| `pnpm test:e2e` | 17 passed, 0 failed, 0 skipped (1.1 min) |
| `pnpm demo:preflight` | 10 of 10 PASS (04:20 IST) |

### Not done / limitations

- Screens listed above as not migrated keep their earlier layouts on the new tokens.
- Remaining deviations from the reference: no Google Sans Flex; Blast Radius tiles are one column on desktop; buttons morph radius on press but there is no shape-morph animation between expressive shapes.
- PR #1 body edit, repository visibility, and the submission form remain operator actions.

