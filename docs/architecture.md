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

## Egress guard

`apps/worker/src/egress-guard.ts` is a loopback-only HTTP/CONNECT proxy with per-execution credentials. Chromium is configured to send all traffic through it (Playwright forces `<-loopback>` so even `localhost` is proxied). For every connection the guard resolves DNS itself, rejects the destination if any resolved address is non-public (unless the host:port is allowlisted and the deployment is in `local` mode), and then connects to the exact address it checked. See [security.md](security.md).

## Data model

`operators`, `operator_sessions` (SHA-256 of the token only), `projects`, `scans`, `scan_executions` (one per role), `execution_events` (ordered evidence timeline), `artifacts` (storage key, size, SHA-256, dimensions), `worker_instances` (heartbeats). Migrations live in `packages/db/migrations` and are generated with `pnpm db:generate`.

## Designed-for extensions

- **Chaos engine**: new scenarios are a new `kind` in `scenarioConfigSchema` plus `conditionsFor` and executor steps. Throttling, viewport sweeps, and recovery checks fit the same baseline/fault execution model; more than two executions per scan is supported by the schema (unique on `scan_id, role`; new roles can be added).
- **Fault DNA**: every event has a stable `(execution_id, seq)` identity that graph edges can cite.
- **AI detective**: `AiAnalysisAdapter` consumes the exported report only and must cite event/artifact ids; results are typed as `kind: "hypothesis"`.
- **Verified repair**: `RepairRequest.verificationScanId` links an independent rerun; only that rerun's evidence can mark a repair verified.
- **Proof vault**: artifacts are content-addressed by hash in reports; adding HAR, DOM snapshots, or trace files is another `artifacts.kind`.
