# Change log

Newest first. Timestamps come from the Git commit history (IST, UTC+05:30). Validation notes restate what [PHASE_STATUS.md](PHASE_STATUS.md) records; this log adds no new test claims.

## 2026-10-25T03:40+05:30 — Last mile: wrong-event rules removed, Daluxe 360 px rerun, second PR verdict

- Changed: Deleted `RULES.md` (it described another event: 10–11 October, Codex) and its references in `SUBMISSION.md`, `AGENTS.md`, `.github/pull_request_template.md`, `AI_USAGE.md`. `SUBMISSION.md` keeps six organizer questions. New shared `developmentEndpointNote`: a public site whose visitors' browsers request a loopback origin gets a plain-language note on the Blast Radius card, drawer, and experiment page. `pnpm repair:comment` gains `--run`, `--title-detail`, `--limitation`; `buildRepairVerdictComment`/`postVerificationComment` accept any completed run of the repair, describe a cross-check by its own journey, fault, and test, and leave the repair's verdict-comment columns alone for runs other than the latest. `--out` resolves against `INIT_CWD`. Daluxe journey v2 (`2f1fdb64…`, width-independent cart target) and analysis `83758bb7…`. Posted the STILL FAILING (journey v2) comment on PR #1. `docs/PR1_BODY_CLEAN.md`, `docs/PR1_VERDICT_COMMENT_V2.md`, new verification screenshot `e3877d0a….png`. README, pitch, runbook (tab C now `83758bb7…`, new tab H), submission, status.
- Why: The 360 px BROKEN cell came from a desktop-only selector in the journey, not the store. The PR needed both verdicts. The rules file belonged to a different hackathon.
- Validation: See PHASE_STATUS.md, Phase 4.2: typecheck, lint, build exit 0; `pnpm test` 260 passed (161 + 5 + 34 + 60), 0 skipped; `pnpm test:e2e` 17 passed; preflight 10 of 10.
- Limitations: PR #1 body not edited (operator command). The clicked route was not timed (no sign-in in this session). The backup video predates this pass.

## 2026-10-25T03:05+05:30 — Phase 4.1 status, gates, and AI usage

- Changed: `PHASE_STATUS.md` gains the Phase 4.1 section (every step, real-app findings, gates, limitations). `AI_USAGE.md` records this session.
- Why: Keep the build record blunt and complete in the bookkeeping files, so README can speak as the product.
- Validation: Gates at `b1383a0`: typecheck, lint, build exit 0; `pnpm test` 257 passed (158 + 5 + 34 + 60), 0 failed, 0 skipped; `pnpm test:e2e` 17 passed, 0 skipped. gitleaks over 37 commits: 7 synthetic test fixtures only.
- Limitations: Documentation only.

## 2026-10-25T02:58+05:30 — Demo insurance: preflight migration check, runbook, backup video, submission

- Changed: `pnpm demo:preflight` (`apps/worker/src/demo-preflight.ts`) gains a "Database schema" check (applied migrations vs `packages/db/migrations/meta/_journal.json`; FAIL with "Run: pnpm db:migrate") and lists up to three real-app analyses. `DEMO_RUNBOOK.md` rewritten to the three-minute Hook / Break / Understand / Fix / Prove / Close route with tabs A–G and fallbacks (phone hotspot, `pnpm worker:restart`, `pnpm db:migrate`, backup video). New backup walkthrough `docs/demo/faultline-walkthrough.webm`. `SUBMISSION.md` filled (description, track, what is real with links, stack and API attribution, organizer questions); participant names, the form, and the checklist stay with the owner.
- Why: A fresh checkout that pulled new code without migrating failed with an opaque query error in the worker log (seen while testing `pnpm demo`); the presenter needs one screen that catches it. The demo needs a fallback that works with no network.
- Validation: Fresh clone of the pushed branch: `pnpm quickstart` (now 6 of 6 migrations), `pnpm operator:create admin`, `pnpm demo`; a scripted browser signed in, created a project for `http://localhost:4600`, saved a journey, and launched a Blast Radius analysis (`a7aba9da…`) that completed in 48 s with `/api/catalog` and `/api/inventory` BROKEN and `/api/recommendations` RESILIENT; no error or warning lines in the demo log. Live preflight: 10 of 10 PASS, exit 0. Against a database without the migrations table and a closed web port: "Database schema" and "Web app" FAIL, exit 1. Video: 156.7 s at 1366×768 (duration read in Chromium), frames at 0:30, 1:40, and 2:20 inspected.
- Limitations: The video has captions but no audio (Playwright screen recording). It is 20.8 MB and lives in the repository. Before the schema check existed, the fresh clone's first `pnpm demo` ran on a database at 5 of 6 migrations because the checkout had moved after `pnpm quickstart`; rerunning `pnpm quickstart` fixed it.

## 2026-10-25T02:40+05:30 — Real-app scan, cross-check verdict, README in product voice

- Changed: `README.md` rewritten in the required order (title, verdict screenshot, "Proven live" links with IST times and the verdict scope, a five-command "Try it", how it works, the Daluxe Official scan, known limitations, architecture, roadmap and AI usage). `docs/vision.md` moved to `docs/ROADMAP.md`. `HACKATHON_PITCH.md` follows the Hook / Break / Understand / Fix / Prove / Close script with a table that ties each spoken line to a stored record. `FINAL_VERIFICATION_REPORT.md`: credits row corrected (API returns `acus_consumed: 0`; stored as a decimal since `905595c`), verdict scope, PR comment link, and the cross-check. New screenshots: `docs/screenshots/08-verdict-scope.png`, `09-cross-check-still-failing.png`, `real-app/01-blast-radius-map.png`, `real-app/02-reality-split-js-bundle-unavailable.png`. `CLAUDE.md` (engineering contract) is now tracked. Two changelog headings corrected to their real commit times (02:16 and 02:29, previously 02:35 and 02:50).
- Results recorded: Daluxe Official project `13327180-4c6e-41e1-9b4a-0b445cdb64fb`, analyses `004f212e…`, `e24a90ca…`, `e9044023…` (18 experiments): main JS bundle unavailable BROKEN reproduced twice (97.38% pixels); 3 s latency on bundle and CSS, CSS and 5 images unavailable RESILIENT (0.00%); `localhost:8081` RESILIENT once and INCONCLUSIVE once (product page timeout); offline INCONCLUSIVE (no expectation configured); 360 px BROKEN reproduced, caused by the journey's desktop-only cart selector (a manual 360 px check found a working cart button); that finding's regression test validation timed out at 180 s. Cross-check run `24f9f532-399d-40f4-9e7c-80110f59a859`: commit `b750bd3` judged by journey v2 (out-of-stock Camp Bottle must stay disabled while `/api/inventory` returns 503) is STILL FAILING, 2 of 2; the repair's VERIFIED FIXED verdict is unchanged.
- Why: Judge-ready documentation must speak as the product and link to live proof; the stricter journey tests the trade-off Devin stated in its PR.
- Validation: README checked for the banned words in `CLAUDE.md` (none). Every ID, time, and percentage above was read from the FAULTLINE database. Screenshots taken from the running app as `phase3-demo`.
- Limitations: The PR comment was not updated with the cross-check (one comment per run). The screenshots in the PR comment render only after this branch is on `main` and the repository is public.

## 2026-10-25T02:29+05:30 — Cross-checks and the `assertDisabled` journey step

- Changed: Journeys gain `assertDisabled` (schema, journey engine, generated Playwright test, builder). `packages/db` migration `0005` adds `verification_runs.cross_check_experiment_id` and `cross_check_regression_test_id`. `queueCrossCheck` queues a verification of the repair's pull request head judged by another finding in the same project, using that finding's validated regression test, journey version, and fault. The worker loads the cross-check finding when set, checks the test's hash against the run, and records "Cross-check verdict" events. A cross-check never changes the repair's status, verdict, or latest verification. The repair page lists cross-checks separately with their own verdict and scope line, and offers a form to queue one (free; no Devin call).
- Why: VERIFIED FIXED covers the tested journey only. Devin's PR states that out-of-stock items become purchasable while inventory is down. A newer journey version with that assertion has to be able to judge the same commit without rewriting the original, immutable verdict.
- Validation: `pnpm typecheck`, `pnpm lint` exit 0. Shared 158 passed (new: generated test asserts `toBeDisabled`). Worker `test/repair.test.ts`: the new CROSS-CHECK test and the VERIFIED FIXED test passed; the cross-check reached `verified_fixed` with the fixed storefront while the repair stayed `ready_for_verification` with no verdict. Migration applied to `faultline` and `faultline_test`.
- Limitations: Only findings whose regression test validated as failing on the original site can judge a commit. A cross-check uses the original revision recorded on the repair.

## 2026-10-25T02:16+05:30 — Demo preflight, quickstart, and redirect-limit fix (`8c4afb3`, `1dc17a4`, `7a07be3`)

- Changed: `pnpm demo:preflight` (`apps/worker/src/demo-preflight.ts`) prints PASS/FAIL for PostgreSQL, MinIO, a worker heartbeat under 30 s old, the container runtime, a Chromium launch, the web app, the reference storefront, GitHub (reads each repair repository), and Devin (`GET /v3/self` only), then demo URLs read from stored records; exit 1 on any failure. `pnpm worker:restart` rebuilds and starts the worker. `pnpm quickstart` writes `.env` if missing, starts PostgreSQL and MinIO with Docker Compose or podman-compose (honoring `COMPOSE_PROJECT_NAME`), retries migrations until PostgreSQL is ready, and installs Chromium. `pnpm demo` runs the storefront, worker, and web app together. `apps/worker/src/executor.ts`: a page FAULTLINE closes itself at the redirect limit is no longer classified as a browser crash.
- Why: Judges need a short, working setup; the presenter needs one screen that says the demo will work. The executor test `stops at redirect loops` failed: Chromium now reports `net::ERR_ABORTED` after FAULTLINE closes the page, and the outer error handler marked that as a crash.
- Validation: `pnpm demo:preflight` live: 9/9 PASS, exit 0; with the web URL pointed at a closed port: FAIL lines and exit 1. Fresh clone of the pushed branch in an empty directory: `pnpm install --frozen-lockfile` (56.7 s) and `pnpm quickstart` (isolated compose project `faultline-fresh`, alternate ports) completed; `pnpm operator:create admin` created the operator. Executor tests 14/14 three times after the fix.
- Limitations: `pnpm demo` binds ports 3000, 4600, and 4601, so it cannot run beside another FAULTLINE stack.

## 2026-10-25T02:00+05:30 — Verdict scope, agent-stated limitations, decimal credits, PR verdict comment

- Changed: `packages/shared/src/verdict-report.ts` (new): `verdictScope` (one scope line per verdict; "byte-identical" only when both healthy-path screenshot hashes match), `extractAgentLimitations` (bullets under a PR description's "Known limitations" heading, redacted), and `buildVerdictComment` (Markdown with a hidden idempotency marker). `GitHubClient` gains `listIssueComments` and `createIssueComment`, FAULTLINE's only GitHub write. `packages/db` migration `0004`: `devin_acus_consumed` becomes `double precision`; adds `pr_agent_limitations` and `verdict_comment_*` columns. `packages/db/src/verdict-comment.ts` (new): `postVerificationComment` checks the stored comment ID, then searches the PR for its marker, then posts; a short claim column stops double clicks. CLI `pnpm repair:comment <repairId> [--dry-run] [--out file]`. Worker sync stores Devin's ACUs unrounded and the PR's limitations. Repair page: scope line in the verdict report and in each verification run, "Agent-stated limitation" quote, **Post verdict on pull request** (approvers only), and **Verdict report (Markdown)** download (`GET /api/repairs/{id}/verdict`). The session panel no longer shows a zero ACU figure; it links to the Devin session instead. `.env.example` documents `FAULTLINE_COMMENT_IMAGE_URL`.
- Why: Judges ask what VERIFIED FIXED covers. Devin's own PR states that out-of-stock items can be added while inventory is down; the verdict must sit next to that, and the verdict must be visible on the PR itself.
- Validation: `pnpm typecheck` and `pnpm lint` exit 0. Shared tests 157 passed (8 new for scope, limitations, and comment; 1 new for the GitHub comment calls). Worker `test/repair.test.ts` 16 passed, 1 skipped (real containers need `GITHUB_TOKEN`); the VERIFIED FIXED test now posts a comment through a stubbed GitHub client and checks it is posted once, not again, and found by marker after a lost response. Migration applied to `faultline` and `faultline_test`. Live: after restart the worker's sync stored 3 limitations from PR #1's real body; Devin's `GET` session returns `acus_consumed: 0`, so the UI hides it. `pnpm repair:comment … --dry-run` produced `docs/PR1_VERDICT_COMMENT.md` from stored rows.
- Limitations: GitHub has no API to upload comment images, so screenshots are linked from `docs/screenshots/verification/` (named by SHA-256) and render only once this repository is public. One comment per verification run; an existing comment is never edited.

## 2026-10-25T01:23+05:30 — Phase 3.6 live Devin repair verified; demo documents

- Changed: New `FINAL_VERIFICATION_REPORT.md`, `DEMO_RUNBOOK.md`, `HACKATHON_PITCH.md`, `docs/vision.md`, and real screenshots in `docs/screenshots/`. `README.md` now leads with the verified live result and links the new documents. `PHASE_STATUS.md` records the live run and gates. `SUBMISSION.md` no longer says repair is unimplemented. `AI_USAGE.md` records the work.
- Why: The full loop (finding, approval, Devin session, GitHub PR, independent verification) completed with real records, and the demo needs an accurate route and report.
- Validation: The operator approved repair `268eeabb…` in the UI at 00:59:36 IST. Devin session `60a680e3…` was confirmed through the v3 API, and it is the only session with the repair tag. PR #1 (head `b750bd3`, author `app/devin-ai-integration`) was confirmed through the GitHub API. Verification run `39c125f0…` returned VERIFIED FIXED: original fails 2/2 under the fault, candidate passes 2/2, normal journeys pass. All verification screenshots re-hashed through the API: match. The repository's own tests were run offline in containers on both commits.
- Limitations: One fault, one journey, Chromium only. PR #1 is not merged. See PHASE_STATUS.md Phase 3.6.

## 2026-10-25T01:16+05:30 — Fix repair page overflow on phones (`d72a39b`)

- Changed: `apps/web/src/app/(app)/repairs/[repairId]/page.tsx`: report and audit-trail text wraps anywhere, and audit-trail grid columns can shrink. `apps/web/src/components/shell/navigation.tsx`: the bottom bar has one shrinkable column per item; it had 4 columns for 5 items. This entry was written in the following documentation commit, not in `d72a39b` itself.
- Why: A read-only walkthrough found that the verified repair page was 53 px wider than a 430 px phone screen. The cause was full SHAs and archive names with no break points.
- Validation: `pnpm --filter @faultline/web typecheck` and `lint` passed. `pnpm build` passed. `pnpm test:e2e` 17 passed. Live mobile check at 430 px: 0 px overflow on the repair, finding, and other pages; all five nav items fit in one row.
- Limitations: The existing responsive E2E test does not visit a repair detail page, because none exists in the E2E database. The check was done against the live dev data.

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
