# FAULTLINE — engineering contract (read on every session)

FAULTLINE: **Break it. Understand it. Fix it. Prove it.** An evidence-first web reliability tool. Core engine works without any AI key. Devin is an optional, approval-gated repair provider. FAULTLINE, not the agent, decides verdicts.

## Non-negotiables
1. No fabricated data: no seeded customers, mock scan results, synthetic PRs, fake agent feeds, or hardcoded scores. Fixtures live only inside tests.
2. Only authorized targets. Bounded, non-destructive faults. No SSRF to private/metadata ranges except explicit operator-local mode.
3. A verdict (VERIFIED FIXED / STILL FAILING / REGRESSION DETECTED / INCONCLUSIVE / BLOCKED) comes only from an independent browser run against an exact commit SHA. Never from an LLM, a PR merge, or Devin's self-report.
4. Paid Devin sessions require a human click in the UI. Never create approval via SQL, scripts, API calls, or UI automation. Never retry an ambiguous create blindly.
5. `faultline-verification-fixture@b7cc293` is a developer test control. Never present it as a Devin repair.
6. Secrets never appear in logs, artifacts, source, docs, or chat output. Report leaks by location, not content.
7. Never force-push, merge to `main`, change repo visibility, deploy publicly, or submit anything without explicit operator instruction in the current prompt.
8. Tests are never weakened to go green. Report exact counts, skips, and failures.

## Voice (judge- and user-facing docs: README, pitch, PR comments, UI copy)
- Speak **as the product**, present tense, confident. Proof comes from links, screenshots, IDs and timestamps, not hedging words.
- Banned in README.md and UI: "reported", "developer-reported", "not independently audited", "verify in another file", "claims", "allegedly", "NOT YET VERIFIED" as a headline.
- Internal truth-tracking (branches, SHAs, what's live-verified vs built) lives in `PHASE_STATUS.md`, `CHANGELOG.md`, `AI_USAGE.md`. Keep those blunt and complete.
- Limitations are stated plainly in one "Known limitations" section. Honesty is a feature; hedging is not.

## Stack (do not migrate)
Next.js/React/TS · Tailwind · Playwright + Chromium · PostgreSQL · MinIO · worker process · Podman candidate verification · Devin API v3 · GitHub. pnpm. Gates: `pnpm typecheck && pnpm lint && pnpm build && pnpm test && pnpm test:e2e`.

## Design system
Android 16 / Material 3 Expressive, adapted for web. Spec and tokens: `docs/DESIGN_SYSTEM.md`. Do not invent a second visual language.

## Reporting format (end of every prompt)
Branch + SHA · what changed · gate results with exact numbers · what is blocked and why · exact operator actions needed. No "should work"; only what was run.
