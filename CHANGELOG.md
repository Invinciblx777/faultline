# Change log

Newest first. Timestamps come from the Git commit history (IST, UTC+05:30). Validation notes restate what [PHASE_STATUS.md](PHASE_STATUS.md) records; this log adds no new test claims.

## 2026-10-25T00:48+05:30 — Phase 3.6 connection preflight: Devin repository access confirmed

- Changed: `PHASE_STATUS.md` gains a Phase 3.6 section. `AI_USAGE.md` records the check. No code changed.
- Why: The operator granted the Devin GitHub app access to `Invinciblx777/faultline-reference-shop`; it had to be verified live before approval.
- Validation: `checkDevinRepositoryAccess` called live returned `ok` (service user, organization matches, repository listed through `github.com`). **Check repository access** on the repair page stored `devin_status = ok`. Repair `268eeabb…` checksums recomputed: match; still `awaiting_approval` with no session. The stored regression test still fails against the original storefront. Approval UI is enabled.
- Limitations: Repository listing does not prove clone or push access. No Devin session yet: approval is left to the operator.

## 2026-10-25T00:40+05:30 — Phase 3.5 fail-closed repository-access preflight

- Changed: `packages/shared` adds `checkDevinRepositoryAccess` (read-only `GET /v3/self` plus the organization's repository list; fails on rejected credentials, a key from another organization, refused or failed requests, a repository Devin does not list, or a non-GitHub connection). `packages/db` migration `0003` adds `source_repositories.devin_checked_at` and `recordDevinAccess`. `apps/web`: approval runs the live check for the request's exact repository before the existing atomic status-and-checksum update, and refuses when the project was relinked. The repair page disables approval with the specific reason unless a successful check is under 10 minutes old, and adds **Check repository access**. `apps/worker`: `submitRepair` runs the live check after claiming and before uploading screenshots or creating the session, and passes Devin's own `repo_full_name` as `repos`. Docs: `README.md`, `docs/security.md`, `PHASE_STATUS.md`, `AI_USAGE.md`.
- Why: The approval gate checked only that a key was configured. A session approved before Devin's GitHub app could see the private repository would spend credits without being able to clone it.
- Validation: `pnpm test` passed (shared 148, db 5, web 34, worker 55 passed with 4 skipped: the real-container tests need `GITHUB_TOKEN` in the test shell). New tests cover a missing repository, a key from another organization, a refused organization, failed API requests (401, 500, 503, network, malformed body), stale, unchecked, or failed stored state, a relinked project, and successful access. `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. Dev database migrated. Web and worker restarted on the new build. A live read-only recheck for repair `268eeabb…` found credentials valid and the organization matching, but Devin still does not list `Invinciblx777/faultline-reference-shop`. In the browser, approval is disabled with that reason. No session was created and nothing was approved.
- Limitations: Devin's repository listing is the only evidence of access. It does not prove that Devin can clone or push. The worker's check runs before the screenshot uploads, so a few seconds of uploads separate it from the session request. A preflight failure in the worker ends the request (`devin_failed`); a new repair request is then needed.

## 2026-10-25T00:15+05:30 — Phase 3.5 rerun with v3 service-user key

- Changed: `PHASE_STATUS.md` Phase 3.5 records the rerun. Local `.env` (not committed): the `cog_` key the owner had saved in `DEVIN_ORG_ID` was moved to `DEVIN_API_KEY`, and `DEVIN_ORG_ID` was set to the `org_id` from `/v3/self`. `AI_USAGE.md` records the work.
- Why: To verify the live Devin v3 connection before the owner approves the first real session.
- Validation: `GET /v3/self` 200 (service user, org matches). v3 sessions and repositories reads 200. Web and worker restarted; the worker reports Devin configured. Repair `268eeabb…` checksums match and it is still awaiting approval.
- Limitations: Devin's Git connections list no repositories, so Devin's access to `faultline-reference-shop` is not granted. The approval gate does not check this. No session has been created.

## 2026-10-25T00:03+05:30 — Phase 3.5 live Devin readiness check (blocked)

- Changed: `PHASE_STATUS.md` gains a Phase 3.5 section with the actual results of the live Devin readiness checks. `AI_USAGE.md` records the check.
- Why: The repository owner configured Devin credentials and asked to verify the live connection before approving the first real session.
- Validation: Read-only calls only. `GET /v3/self`, `GET /v3/organizations/{org}/sessions`, and `GET /v3/organizations/{org}/repositories` returned HTTP 403. Legacy `GET /v1/sessions` returned 200, showing that the key is a legacy `apk_` key. No FAULTLINE-tagged session exists. Stored evidence, prompt, and regression-test checksums for repair `268eeabb…` were recomputed and match. `faultline-reference-shop` `main` is unchanged at `6c9ca4c` and has no PRs. Web and worker were restarted and are healthy.
- Limitations: The live Devin session, the pull request check, and independent verification were not run. They need a v3 service-user key (`cog_`). Devin's GitHub access could not be checked with this key.

## 2026-10-24T23:44+05:30 — Record all models used in AI usage

- Changed: `AI_USAGE.md` now lists GPT Astra 6, Claude Opus 5.5, and Claude Fable as the models used to build the project.
- Why: The repository owner reported using these models; the record must name them.
- Validation: Documentation-only change; read back the edited file.
- Limitations: The model list is as reported by the repository owner and is not verified from tool logs. The per-task rows do not split work between GPT Astra 6 and Fable.

## 2026-10-24T23:38+05:30 — Correct two Phase 3 changelog timestamps

- Changed: `CHANGELOG.md`. The two previous headings were written with estimated times (23:40 and 23:55) that were later than the actual commits; they now show the commit times of `d3d17c7` (23:36) and `7ceb642` (23:38).
- Why: Timestamps must be accurate.
- Validation: Compared against `git log --date=iso`.
- Limitations: None.

## 2026-10-24T23:38+05:30 — Phase 3 documentation

- Changed: `README.md` (Phase 3 features, repair setup), `.env.example` (Devin, GitHub, repair, and verification settings with empty values), `docs/architecture.md` (repair lifecycle and verification stages), `docs/security.md` (repair integration controls and limitations), `docs/api.md` (repair routes, `faultline.repair-evidence/v1`), `PHASE_STATUS.md` (Phase 3 criteria, gates, defects, limitations, what remains), `AI_USAGE.md`.
- Why: Document setup, behavior, and the exact verified and unverified parts of Phase 3.
- Validation: Claims checked against the code (redaction patterns, logged fields, container flags) and against the test and walkthrough results recorded in the previous entries.
- Limitations: The live Devin step remains undocumented by evidence because it has not run.

## 2026-10-24T23:36+05:30 — Phase 3: real-container verification, E2E, live walkthrough fixes

- Changed: `apps/worker/test/repair.test.ts` gains a real-container verification of real GitHub commits of `Invinciblx777/faultline-reference-shop` (base `6c9ca4c` and fix `b7cc293` on branch `faultline-verification-fixture`, written by the FAULTLINE developers as a verification fixture, not by Devin); tests now assert they claim their own verification run. `apps/web/e2e/repair.spec.ts` (unauthorized repository refused, shell-like recipe refused, Devin shown as not configured, repair APIs require sign-in); the Blast Radius E2E checks that repair asks for a linked repository first. Linking a repository now refreshes the project page and stores GitHub's canonical `owner/name`. The repair evidence panel labels not-reached steps as "Steps that did not pass under the fault".
- Why: Prove the verification engine on real commits in real containers, and fix two defects found while walking through the UI in the dev environment (stale project page after linking; lower-cased owner from the allowlist).
- Validation: `pnpm typecheck`, `pnpm lint`, `pnpm build` pass. `pnpm test` with `GITHUB_TOKEN` from `gh auth token` in the process environment: shared 142, db 5, web 27, worker 57 passed. Real containers: fix commit `b7cc293` → VERIFIED FIXED, unchanged base `6c9ca4c` → STILL FAILING. `pnpm test:e2e`: 17 passed. Live walkthrough on the dev stack: repository linked (GitHub Connected, Devin Not configured), repair request `268eeabb-af9e-4b86-828b-fbcf065f2a88` created from finding `5f64dd02`, approval disabled with the reason shown.
- Limitations: No live Devin session: `DEVIN_API_KEY` and `DEVIN_ORG_ID` are not available, so approval, session creation, and a Devin-authored pull request remain unverified against the real Devin service. The fixture commit has no pull request; the real-container test answers only the pull request lookup locally.

## 2026-10-24T23:13+05:30 — Phase 3 repair tests

- Changed: `apps/worker/test/repair.test.ts` (Devin submission, recovery, and sync with Devin's HTTP API stubbed at the fetch layer; verification with real Chromium and Playwright Test against fixed, unfixed, and regressing storefront builds), `apps/worker/test/candidate.test.ts` (real podman container build of `Invinciblx777/faultline-reference-shop@6c9ca4c`), `apps/worker/test/fixtures.ts` (patched-storefront fixture on a chosen port), `apps/web/test/repair-services.test.ts` (repository authorization, recipe validation, approval rules), shared unit tests from the previous entry. `GitHubClient` read methods are now `async` so invalid input always rejects instead of throwing synchronously.
- Why: Each verdict (VERIFIED FIXED, STILL FAILING, REGRESSION DETECTED, INCONCLUSIVE, VERIFICATION BLOCKED) and each submission safeguard (approval checksum, single session per approval, tag recovery without re-creating, no submission without credentials) needs evidence that it behaves as specified.
- Validation: `vitest run test/repair.test.ts` 14 passed (about 110 s, real analysis plus four real verification runs); `vitest run test/candidate.test.ts` 3 passed with `GITHUB_TOKEN` supplied from `gh auth token` in the process environment only (not written to any file); web repair service tests 5 passed.
- Limitations: Devin itself is stubbed in these tests; no live Devin session has been created because no Devin credentials are configured. The container test is skipped when `GITHUB_TOKEN` or podman is unavailable.

## 2026-10-24T23:01+05:30 — Phase 3 repair UI (wip)

- Changed: `apps/web` — repair services and server actions (link repository, create repair request, approve, cancel, sync, queue verification, Devin connection test), `/repairs` list and `/repairs/[id]` workspace (progress stepper, approval panel, Devin session, GitHub-confirmed pull request, verification before/after screenshots and checks, verification report, audit trail), "Fix with Devin" panel on eligible findings, source repository card on the project page, Devin and GitHub status on Settings, live status and verification screenshot API routes.
- Why: Operators review the evidence and approve a Devin session explicitly; the UI shows only stored facts and keeps Devin's messages separate from FAULTLINE's verification.
- Validation: `pnpm --filter @faultline/web typecheck` and `lint` pass. Not yet exercised in a browser or covered by tests.
- Limitations: Polling the page reads FAULTLINE's database only; the worker contacts Devin on its own interval. Approval stays disabled until `DEVIN_API_KEY`, `DEVIN_ORG_ID`, and `FAULTLINE_REPAIR_APPROVERS` are set.

## 2026-10-24T22:52+05:30 — Phase 3 repair core: Devin and GitHub clients, repair persistence, verification engine (wip)

- Changed: `packages/shared` (repair lifecycle, evidence bundle and prompt builders, pull request validation, verification verdict rules, Devin API v3 and GitHub REST clients, repair env settings), `packages/db` (migration `0002`: `source_repositories`, `repair_requests`, `repair_events`, `verification_runs`, `verification_checks`; conditional lifecycle transitions), `apps/worker` (repair supervisor: Devin submission with tag-based recovery, session and pull request sync, isolated candidate builds with podman, independent verification).
- Why: Phase 3 (Devin Strike). A finding becomes an approved Devin repair request, and FAULTLINE verifies the resulting pull request itself.
- Validation: `pnpm typecheck` for shared, db, worker, web; shared unit tests (142 passed, including verdict rules, sanitization, prompt, PR validation, Devin client retries and error categories). Migration applied to `faultline` and `faultline_test`. Devin request and response shapes were checked against Devin's published OpenAPI document (`v3-openapi.json`).
- Limitations: No UI yet. No live Devin call has been made: `DEVIN_API_KEY` and `DEVIN_ORG_ID` are not configured in this environment. Worker repair code is not yet covered by integration tests.

## 2026-10-24T22:10:02+05:30 — Phase 2 docs (a32e094)

- Changed: Phase 2 status, Blast Radius architecture, security controls, API documentation.
- Why: Keep documentation in step with the Blast Radius implementation.
- Validation: See PHASE_STATUS.md.
- Limitations: AI analysis, Devin/GitHub repair, and Fault DNA graphs are not implemented.

## 2026-10-24T22:06:16+05:30 — Skipped experiments and interrupted analyses (54b2c3a)

- Changed: `packages/db`. Skipped experiments now say they never started; added tests for interrupted analyses.
- Why: A skipped experiment must not read as a run that happened.
- Validation: See PHASE_STATUS.md.
- Limitations: None identified.

## 2026-10-24T21:57:24+05:30 — Baseline noise and condition counts (2ce500f)

- Changed: `apps/web`. Baseline noise is kept out of the fault sequence; counts for conditions are reported honestly.
- Why: Evidence shown for a fault must come from that fault's run only.
- Validation: See PHASE_STATUS.md.
- Limitations: None identified.

## 2026-10-24T21:52:30+05:30 — Blast Radius E2E and journey JSON import (ddb2d14)

- Changed: End-to-end test of the Blast Radius flow against the storefront reference target; fixed journey JSON import.
- Why: Cover the new flow and fix an import bug the test exposed.
- Validation: See PHASE_STATUS.md.
- Limitations: None identified.

## 2026-10-24T21:45:21+05:30 — Journeys, Blast Radius UI (a3d2c33)

- Changed: `apps/web`. Journeys, Blast Radius launch, map, experiment evidence, findings.
- Why: Expose the Phase 2 engine to operators.
- Validation: See PHASE_STATUS.md.
- Limitations: See PHASE_STATUS.md.

## 2026-10-24T21:29:06+05:30 — Journey engine, dependency discovery, fault experiments, verdicts (051b143)

- Changed: Worker and shared packages. Journey engine, dependency discovery, isolated fault experiments, rule-based verdicts.
- Why: Phase 2 (Blast Radius) core.
- Validation: See PHASE_STATUS.md.
- Limitations: See PHASE_STATUS.md.

## 2026-10-24T21:03:06+05:30 — Phase 1 Genesis checkpoint (02deb6d)

- Changed: Initial platform. Projects, scans (resource failure, offline reload), Reality Split, reports, operator auth, egress guard.
- Why: Phase 1 acceptance criteria.
- Validation: PHASE_STATUS.md lists 13 criteria, each with evidence.
- Limitations: See PHASE_STATUS.md.
