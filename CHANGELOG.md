# Change log

Newest first. Timestamps come from the Git commit history (IST, UTC+05:30). Validation notes restate what [PHASE_STATUS.md](PHASE_STATUS.md) records; this log adds no new test claims.

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
