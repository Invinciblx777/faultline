# Contributing to FAULTLINE

Thanks for helping. FAULTLINE's one rule: **no fabricated evidence**. Every outcome the product shows must trace back to a real execution. Fixtures belong in tests, never in product data or demos.

## Setup

Follow the quick start in the [README](README.md). You need PostgreSQL and MinIO running for the database, worker, and E2E tests.

## Before opening a pull request

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e     # when you touch the web app, worker, or shared contracts
```

- Add or update tests for behavior changes. Browser behavior is tested with real Chromium against local fixture servers (`apps/worker/test/fixtures.ts`), not mocks.
- Schema changes: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, commit the generated SQL in `packages/db/migrations`.
- New scenarios: extend `scenarioConfigSchema` and `conditionsFor` in `packages/shared/src/scenarios.ts`, implement the steps in the executor, and update the report's "cannot conclude" statements.
- UI: reuse `apps/web/src/components/ui`, use the design tokens in `globals.css`, keep keyboard access and reduced-motion support, and label anything not yet working as unavailable rather than faking it.
- Security-sensitive areas (URL policy, egress guard, auth, storage keys, redaction) need tests that cover the bypass you are guarding against.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
