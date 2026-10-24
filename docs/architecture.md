# Architecture

FAULTLINE Phase 1 is three processes sharing PostgreSQL and S3-compatible storage.

```
 Operator browser
       │  HTTPS (session cookie)
       ▼
 ┌──────────────┐  insert scan (queued)   ┌────────────────────┐
 │  apps/web    │ ───────────────────────▶│ PostgreSQL         │
 │  Next.js     │  pg-boss send(job)      │  app tables        │
 │  (no browser)│◀─────────────────────── │  pgboss schema     │
 └──────┬───────┘  read evidence/status   └─────────┬──────────┘
        │ stream screenshots (auth)                 │ claim job, write evidence
        ▼                                           ▼
 ┌──────────────┐   put screenshot (sha256)  ┌────────────────────┐
 │ MinIO / S3   │◀────────────────────────── │ apps/worker        │
 │ private      │                            │ Playwright Chromium│
 └──────────────┘                            │ + egress guard     │
                                             └─────────┬──────────┘
                                                       │ every connection
                                                       ▼
                                             authorized target website
```

## Responsibilities

| Component | Owns | Never does |
|---|---|---|
| `apps/web` | Authentication, projects, scan creation, authorization checks, live status, Reality Split, reports, JSON export, artifact streaming | Launch browsers or fetch target URLs |
| `apps/worker` | Claiming jobs, launching Chromium, fault injection, egress enforcement, evidence capture, screenshot upload, lifecycle updates | Serve HTTP to users |
| `packages/db` | Schema, migrations, atomic lifecycle transitions, queue and storage helpers | Business UI logic |
| `packages/shared` | Zod schemas, scenario definitions, URL/allowlist/IP policy, redaction, report builder, future integration contracts | I/O (except the `network` and `password` subpaths) |

## Scan lifecycle

1. The web app validates the session, the project, and the URL (`checkScanTarget`: same origin as the project, origin on the allowlist), inserts a `scans` row with status `queued`, and sends a pg-boss job carrying only the scan id. If the queue rejects it, the scan is marked `failed` (`enqueue_failed`), never left queued.
2. A worker claims the scan with a conditional `UPDATE … WHERE status='queued'`. Only one worker can win. A scan cancelled while queued can never be claimed.
3. The worker re-checks authorization (the allowlist may have changed), launches Chromium, and runs the **baseline** and then the **fault** execution, each in a new browser context with its own egress guard instance.
4. Each execution's events are inserted, its screenshot is uploaded with a SHA-256 computed from the exact bytes, and its row is updated with the outcome.
5. The scan ends `completed` (both executions ran to a recorded outcome), `cancelled`, or `failed` (FAULTLINE could not complete it). A website that fails to load is still a `completed` scan whose execution outcome is `navigation_failed`.
6. Workers heartbeat each running scan every 3 s. Another worker's sweeper marks scans whose heartbeat is older than 90 s as `failed` (`worker_interrupted`), keeping any evidence already stored.

Scan status and execution outcome are deliberately separate. The UI shows both.

## Execution engine

`apps/worker/src/executor.ts` runs one execution:

- Fresh context: fixed viewport (desktop 1366×900 or mobile 430×932 touch emulation), `en-US`, UTC, no permissions, downloads refused, popups closed, dialogs dismissed.
- Service workers are **blocked** for resource-failure scenarios (so every request passes through interception) and **allowed** for offline scenarios (so an application's own offline support can be observed).
- `context.route('**/*')` enforces the request budget, refuses main-frame navigations outside the allowlist, and aborts requests matching the fault scenario. Aborted requests are recorded as `fault_injected` and excluded from unexpected failures. Chromium's own console message about an aborted request is kept but marked as a consequence of the fault.
- Observers record console errors and warnings, uncaught exceptions, failed requests, HTTP responses ≥ 400, redirects, navigations, crashes.
- Steps: navigate (`load`), bounded `networkidle` wait, optional offline switch + reload, title, full-page PNG (viewport only if the page exceeds the height limit).
- Hard limits: navigation timeout, scenario timeout, redirect limit, request budget, transfer budget. Hitting a limit is recorded as evidence.

## Blast Radius analyses (Phase 2)

A Blast Radius analysis is a scan with `scenarioKind = "blast-radius"`. It runs a saved journey version many times in one pg-boss job (`apps/worker/src/blast-radius-runner.ts`):

1. **Journey snapshot.** `journeys` rows are immutable versions in a lineage (`lineage_id`, `version`). The scan stores a copy of the exact definition it runs (`scans.journey_snapshot`). A journey (`faultline.journey/v1`, `packages/shared/src/journey.ts`) is data: navigate / reload / click / fill / wait / assert steps with structured locators (role, text, label, placeholder, test id, plain CSS). Nothing in it is evaluated as JavaScript.
2. **Baseline and calibration.** Two runs under normal conditions (`apps/worker/src/journey-executor.ts`), each in a fresh context through the egress guard. Every step is timed. Assertions use Playwright's `expect`. The network log stores method, redacted URL, resource type, status, timing, step index, and whether FAULTLINE injected the outcome. It stores no headers, cookies, or bodies. Steps that did not pass in both runs are excluded from verdicts. The two final screenshots set the visual-difference threshold: 3× their difference, at least 1%.
3. **Dependency discovery.** `discoverDependencies` groups the observed requests: third-party traffic by origin, first-party fetch/XHR by method and normalized path, other first-party resources by path. Discovery covers only what this journey requested.
4. **Experiment planning.** `planExperiments` chooses dependency × fault pairs (explicit targets, or first-party APIs first) up to `maxExperiments`. It adds the optional offline and narrow-viewport conditions. Every candidate it does not run is stored with a reason.
5. **Experiments.** Each experiment is one fault in a fresh context:
   - **Unavailable:** abort with `connectionrefused`.
   - **HTTP error:** fulfill with a FAULTLINE-generated 500/503 marked `x-faultline-injected`. This applies only to first-party GET/HEAD endpoints.
   - **Latency:** hold the request, then continue it unchanged.
   - **Offline:** `context.setOffline(true)` after the first navigation.
   - **Narrow viewport:** 360×740 with overflow and off-screen control checks.

   `evaluateExperiment` turns observations into BROKEN / DEGRADED / RESILIENT / INCONCLUSIVE / TEST FAILED using fixed rules. BROKEN and DEGRADED results are re-run once (`combineAttempts`); a result that does not repeat becomes INCONCLUSIVE.
6. **Regression tests.** For each finding `generateRegressionTest` writes a standalone Playwright Test file that applies the same fault and replays the stable steps. The worker runs it with the real Playwright Test runner (`regression-validator.ts`) through the egress guard. It records whether the test fails against the current site, as expected for a reproduced finding.

The analysis job may stay active for up to 1 hour (`ANALYSIS_JOB_EXPIRE_SECONDS`). The worker enforces `FAULTLINE_ANALYSIS_TIMEOUT_MS` (default 30 min) and skips the remaining experiments with a reason. If the worker dies, the stale sweep marks the analysis `worker_interrupted`: running work becomes failed, pending experiments become skipped, and recorded evidence is kept.

## Devin repair and independent verification (Phase 3)

```
finding ──▶ repair request (evidence + checksum + prompt, awaiting_approval)
              │ operator on FAULTLINE_REPAIR_APPROVERS approves (checksum must match)
              ▼
            queued ──▶ worker claims (submitting) ──▶ POST /v3/organizations/{org}/sessions
              │                                         tags: faultline, faultline-repair-<id>
              │  response lost? stay submitting; recover by GET sessions?tags=… ; never resend
              ▼
            devin_running ──poll every FAULTLINE_DEVIN_POLL_INTERVAL_MS──▶ session status, messages (deduped by event_id)
              │  session reports a PR URL ──▶ GitHub API confirms repo, base branch, head SHA
              ▼
            ready_for_verification ──operator──▶ verification run for the exact head SHA
              ▼
            verifying: original commit and candidate commit, each in its own container
              A original, normal journey            must pass   (valid baseline)
              B original, regression test ×2        must fail   (failure reproduces)
              C candidate, regression test ×2       must pass   (unchanged test)
              D candidate, normal journey           must pass   (no regression)
              ▼
            verified_fixed | still_failing | regression_detected | inconclusive | verification_blocked
```

- **Web** (`apps/web/src/lib/services/repairs.ts`) only writes rows: link repository, create request, approve, cancel, request sync, queue verification. Page polling reads `/api/repairs/{id}` from the database and never calls Devin.
- **Worker** (`apps/worker/src/repair/`) runs a supervisor with two loops: agent work (submit approved requests, recover unconfirmed submissions, sync active sessions) and verification (one run at a time, heartbeats, stale runs closed as blocked after 90 s).
- **Verdict rules** live in `decideVerification` (`packages/shared/src/repair.ts`), a pure function covered by unit tests. Checks that only collect evidence (screenshots under the fault) never decide the verdict.
- **Candidate builds** (`candidate.ts`): GitHub tarball of the exact SHA → archive inspection (single root naming the commit, no links, no absolute or `..` paths) → extract → `podman run` read-only, `--cap-drop=all`, `no-new-privileges`, uid 65534, pids/memory/CPU limits, source mounted read-only, on an `--internal` network, ports published on 127.0.0.1 only. The container is labeled with the commit; FAULTLINE checks the label and published ports before testing.
- **Tables**: `source_repositories`, `repair_requests` (one open request per finding, unique Devin tag and session id), `repair_events` (append-only audit trail), `verification_runs` (one active run per repair), `verification_checks` (every browser execution with output, steps, errors, screenshot hash).

## Egress guard

`apps/worker/src/egress-guard.ts` is a loopback-only HTTP/CONNECT proxy with per-execution credentials. Chromium is configured to send all traffic through it (Playwright forces `<-loopback>` so even `localhost` is proxied). For every connection the guard resolves DNS itself, rejects the destination if any resolved address is non-public (unless the host:port is allowlisted and the deployment is in `local` mode), and then connects to the exact address it checked. See [security.md](security.md).

## Data model

`operators`, `operator_sessions` (SHA-256 of the token only), `projects`, `scans`, `scan_executions` (unique on `scan_id, role, ordinal`; experiment runs carry `experiment_id` and `attempt`), `execution_events` (ordered evidence timeline), `artifacts` (storage key, size, SHA-256, dimensions; kinds `screenshot`, `step-screenshot`, `diff`), `worker_instances` (heartbeats). Phase 2 adds `journeys`, `dependencies`, `experiments`, `network_requests`, `step_results`, and `regression_tests`. Migrations live in `packages/db/migrations` and are generated with `pnpm db:generate`.

## Designed-for extensions

- **Chaos engine**: new scenarios are a new `kind` in `scenarioConfigSchema` plus `conditionsFor` and executor steps. Throttling, viewport sweeps, and recovery checks fit the same baseline/fault execution model; more than two executions per scan is supported by the schema (unique on `scan_id, role`; new roles can be added).
- **Fault DNA**: every event has a stable `(execution_id, seq)` identity that graph edges can cite.
- **AI detective**: `AiAnalysisAdapter` consumes the exported report only and must cite event/artifact ids; results are typed as `kind: "hypothesis"`.
- **Verified repair**: `RepairRequest.verificationScanId` links an independent rerun; only that rerun's evidence can mark a repair verified.
- **Proof vault**: artifacts are content-addressed by hash in reports; adding HAR, DOM snapshots, or trace files is another `artifacts.kind`.
