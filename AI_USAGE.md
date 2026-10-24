# AI usage record

Brief record of AI assistance on this project. No secrets or chat transcripts.

The template asks for Codex. This project was built with **Claude Code** (Anthropic), not Codex.

Models used to build the project, as reported by the repository owner: **GPT Astra 6**, **Claude Opus 5.5**, and **Claude Fable**. The per-task rows below record which model did which work only where it is known; the owner has not given a per-task split for GPT Astra 6 or Fable.

| Date and time with timezone | Tool / model, if known | Task | Assistance and affected files | Human review / corrections | Validation and result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24, IST | Claude Code, Claude models | Build FAULTLINE Phase 1 and Phase 2 (see [CHANGELOG.md](CHANGELOG.md)) | Wrote and edited code, tests, and docs across `apps/`, `packages/`, `tools/`, `docs/` | Pending: the repository owner has not recorded a review of each change | Test results are in [PHASE_STATUS.md](PHASE_STATUS.md) |
| 2026-10-24, IST | Claude Code, Claude models | Add hackathon template docs | Copied `RULES.md`, `AGENTS.md`, `.github/pull_request_template.md` unchanged from the template. Wrote `CHANGELOG.md`, `AI_USAGE.md`, `SUBMISSION.md` from Git history | Pending | Links checked locally |
| 2026-10-24, evening IST (commits `25d1a40`–final Phase 3 commit) | Claude Code, Claude Opus 5.5 | Phase 3: Devin repair and independent verification | Wrote the Devin v3 and GitHub clients, repair schema and migration, worker repair supervisor and container verification, repair UI, tests, and docs; created the private `faultline-reference-shop` repository and its `faultline-verification-fixture` branch | Pending: the repository owner has not reviewed these changes. Claude corrected its own defects found in tests and a live walkthrough (see PHASE_STATUS.md) | Gates in [PHASE_STATUS.md](PHASE_STATUS.md). Devin itself was not called: no credentials |
| 2026-10-25, 00:00–00:03 IST | Claude Code, Claude Opus 5.5 | Phase 3.5: live Devin readiness check | Ran read-only Devin and GitHub API checks without printing credentials, recomputed stored repair checksums, restarted web and worker, and wrote `PHASE_STATUS.md` results. No code changed and no Devin session was created | Pending owner review | Found that the configured key is a legacy `apk_` key: v3 returns 403. See PHASE_STATUS.md Phase 3.5 |
