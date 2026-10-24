# Project submission

Submit through the organizers' announced method. Fields marked **OPERATOR** need the owner.

## Project

- **Project name:** FAULTLINE
- **Tagline:** Break it. Understand it. Fix it. Prove it.
- **Track:** "Make the Invisible Visible" (**OPERATOR:** confirm, question 5)
- **Short description:** FAULTLINE breaks one dependency of a web app at a time in a real browser, shows exactly which user steps fail, hands the evidence to Devin, and then proves on its own whether the fix works. Each finding comes with a Blast Radius Map, a side-by-side Reality Split, and a generated Playwright regression test. With one human approval, FAULTLINE opens a Devin session. It then runs the resulting pull request's exact commit in a container with no network access, using its own unchanged test, and posts the verdict on the pull request.
- **Code repository URL:** https://github.com/Invinciblx777/faultline (private until the owner makes it public)
- **Final submitted implementation commit SHA:** recorded in the final report of the 2026-10-25 judge-ready session and in [PHASE_STATUS.md](PHASE_STATUS.md). **OPERATOR:** copy it here if the form asks for it.
- **Working demo:** local, self-hosted. Five commands in [README.md](README.md#try-it); click route in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).
- **Demo video:** [`docs/demo/faultline-walkthrough.webm`](docs/demo/faultline-walkthrough.webm), 2 min 39 s, captions, no audio, 22.4 MB (under 25 MB, kept in Git). After the event it moves to a GitHub Release asset. **OPERATOR:** upload it wherever the form asks.

## What is real

| Claim in the demo | Evidence |
|---|---|
| A real Devin session repaired the inventory failure | Session https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a, approved by a human in the UI at 2026-10-25 00:59:36 IST |
| Devin opened PR #1 | https://github.com/Invinciblx777/faultline-reference-shop/pull/1 (open, not merged) |
| FAULTLINE judged commit `b750bd3` VERIFIED FIXED | Run `39c125f0-ca3c-4e33-afb5-ae5c03430097`; verdict comment https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389303315 |
| A stricter journey finds the gap Devin stated | Cross-check run `24f9f532-399d-40f4-9e7c-80110f59a859`: STILL FAILING, 2 of 2; verdict comment https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389982815 |
| A real store was scanned | Project `13327180-4c6e-41e1-9b4a-0b445cdb64fb` (daluxeofficial.in), 4 analyses, 21 experiments. Production storefront requests `http://localhost:8081` from visitors' browsers; 360 px RESILIENT (analysis `83758bb7-4a37-41cf-afdd-b2b73c3f020c`) |

Nothing in the UI is seeded or mocked. Test fixtures live only in test files.

## Participants

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| **OPERATOR** | Invinciblx777 | **OPERATOR** |

## Run and demonstrate

- **Prerequisites:** Linux or WSL2, Node.js 22.12+ (developed on 24.22), pnpm 12.15.0 via corepack, Docker Compose or podman-compose, about 500 MB for Chromium. Repair verification also needs podman (5.8.9 tested), a GitHub token, and a Devin service-user key.
- **Install and start:** `corepack enable pnpm && pnpm install`, then `pnpm quickstart`, `pnpm operator:create admin`, `pnpm demo`.
- **Environment variable names:** [.env.example](.env.example). `pnpm quickstart` writes `.env` with generated secrets.
- **Readiness check:** `pnpm demo:preflight`.
- **Checks performed and results:** [PHASE_STATUS.md](PHASE_STATUS.md).
- **Known limitations:** [README.md](README.md#known-limitations).
- **AI usage record:** [AI_USAGE.md](AI_USAGE.md). **Change log:** [CHANGELOG.md](CHANGELOG.md).

## Stack, libraries, and APIs

- **Languages and runtime:** TypeScript, Node.js, pnpm workspaces.
- **Web:** Next.js (App Router), React, Tailwind CSS, Radix UI, lucide-react, Motion.
- **Worker:** Playwright with Chromium, pg-boss job queue, pixelmatch and pngjs for pixel diffs.
- **Data:** PostgreSQL 17 with Drizzle ORM and drizzle-kit migrations; MinIO through the AWS SDK S3 client.
- **Validation and tests:** Zod, Vitest, Playwright Test, ESLint, typescript-eslint, esbuild, tsx.
- **Verification sandbox:** Podman running the official Node.js image pinned by digest, on an internal network with no egress.
- **External APIs:** Devin API v3 (sessions, attachments, `GET /v3/self`); GitHub REST API (repositories, pull requests, source archives, issue comments).
- **Datasets:** none.

## Questions for the organizers (OPERATOR to confirm in the room)

1. Submission form: what is the URL?
2. Repository: must it be public at submission?
3. Video: is one required, and what is the maximum length?
4. Team name: what name goes on the form?
5. Track: which track is this entered in? (Proposed: "Make the Invisible Visible".)
6. Deadline: what is the exact cut-off time?
