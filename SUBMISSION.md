# Project submission

Submit through the organizers' announced method. Fields marked **OPERATOR** need the owner.

## Project

- **Project name:** FAULTLINE
- **Tagline:** Break it. Understand it. Fix it. Prove it.
- **Track:** Track 2, "Make the invisible visible" (**OPERATOR:** confirm the track name with the organizers)
- **Short description:** FAULTLINE breaks one dependency of a web app at a time in a real browser, shows exactly which user steps fail, hands the evidence to Devin, and then proves on its own whether the fix works. Each finding comes with a Blast Radius Map, a side-by-side Reality Split, and a generated Playwright regression test. With one human approval, FAULTLINE opens a Devin session. It then runs the resulting pull request's exact commit in a container with no network access, using its own unchanged test, and posts the verdict on the pull request.
- **Code repository URL:** https://github.com/Invinciblx777/faultline (private until the owner makes it public)
- **Final submitted implementation commit SHA:** recorded in the final report of the 2026-10-25 judge-ready session and in [PHASE_STATUS.md](PHASE_STATUS.md). **OPERATOR:** copy it here if the form asks for it.
- **Working demo:** local, self-hosted. Five commands in [README.md](README.md#try-it); click route in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).
- **Demo video:** [`docs/demo/faultline-walkthrough.webm`](docs/demo/faultline-walkthrough.webm), 2 min 36 s, captions, no audio. **OPERATOR:** upload it wherever the form asks.

## What is real

| Claim in the demo | Evidence |
|---|---|
| A real Devin session repaired the inventory failure | Session https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a, approved by a human in the UI at 2026-10-25 00:59:36 IST |
| Devin opened PR #1 | https://github.com/Invinciblx777/faultline-reference-shop/pull/1 (open, not merged) |
| FAULTLINE judged commit `b750bd3` VERIFIED FIXED | Run `39c125f0-ca3c-4e33-afb5-ae5c03430097`; verdict comment https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389303315 |
| A stricter journey finds the gap Devin stated | Cross-check run `24f9f532-399d-40f4-9e7c-80110f59a859`: STILL FAILING, 2 of 2 |
| A real store was scanned | Project `13327180-4c6e-41e1-9b4a-0b445cdb64fb` (daluxeofficial.in), 3 analyses, 18 experiments |

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

## Questions for the organizers (OPERATOR to confirm)

1. Event and dates: [RULES.md](RULES.md) describes "DevDay Exchange Community Hackathon: Kochi", 10–11 October 2026, wrap-up by 10:00 IST on 11 October. This project's Git history starts on 24 October 2026, and the pitch targets "Devin Hacks Kochi" with a deadline of 25 October, 11:00 IST. Which event, rules, and deadline apply?
2. "Start from scratch at the event": does work started on 24 October count, under the event's timeline?
3. Codex: RULES.md asks teams to use Codex and document it. This project was built with Claude Code and Devin ([AI_USAGE.md](AI_USAGE.md)). Is that acceptable?
4. Must the repository be public at submission, or is private access for judges enough? If access is enough, which GitHub accounts need it? The reference-shop repository holds PR #1.
5. Video: which format and maximum length? Is a link enough, or is an upload required? Is a captioned video without audio acceptable?
6. Where is the submission form, and what is the exact cut-off time?
7. Is a local (self-hosted) demo acceptable, or is a public deployment required?

## Submission checklist

Left unticked on purpose. The owner ticks only the items that are true.

- [ ] The project implementation started from scratch at the event (see question 1).
- [ ] I participated solo or with no more than 4 team members in total.
- [ ] Codex was used during development and its usage is documented (see question 3).
- [ ] The code repository URL, short description, and working demo are provided.
- [ ] README setup and demo instructions match the submitted code.
- [ ] Actual checks and known limitations are documented.
- [ ] Meaningful changes are documented and committed throughout development.
- [ ] The final implementation is committed and pushed, and its SHA is recorded above.
- [ ] No credentials or private data are included in the repository or demo instructions.
- [ ] The organizers' announced submission method and timing have been followed.
