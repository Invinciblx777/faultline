# Project submission

Fill the TODO fields before submitting through the organizers' announced method. Do not submit to the template repository.

## Project

- **Project name:** FAULTLINE
- **Short description:** Evidence-first web reliability engineering platform. It runs a real user journey in Chromium, injects faults (failing resources, slow or 5xx responses, offline, small viewport), and maps which steps each fault breaks, with recorded evidence and a generated regression test. With operator approval it sends the evidence to Devin. Then it independently verifies the resulting pull request's exact commit in an isolated container. Verified live on 2026-10-25: Devin's PR #1 on our reference storefront was judged VERIFIED FIXED. See [README.md](README.md) and [FINAL_VERIFICATION_REPORT.md](FINAL_VERIFICATION_REPORT.md).
- **Code repository URL:** https://github.com/Invinciblx777/faultline (private)
- **Final submitted implementation commit SHA:** TODO
- **Working demo URL or local demo steps:** Local only. See "Quick start (local)" in [README.md](README.md).
- **Demo access requirements:** Node.js 22.12+, pnpm 12, Docker or Podman for PostgreSQL and MinIO, about 500 MB for Chromium. Create an operator account with `pnpm operator:create`.

## Participants

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | Invinciblx777 | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js 22.12+ (developed on 24.x), pnpm 12.15.0, PostgreSQL 17, MinIO, Playwright Chromium.
- **Install command:** `pnpm install`
- **Required environment variable names:** See [.env.example](.env.example). `pnpm setup:env` generates a local `.env` with secrets.
- **Start command:** `pnpm start:web` and `pnpm start:worker` (after `pnpm infra:up` and `pnpm db:migrate`).
- **Demo walkthrough:** [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) (click-by-click, with fallbacks). Pitch: [HACKATHON_PITCH.md](HACKATHON_PITCH.md).
- **Checks performed and results:** See [PHASE_STATUS.md](PHASE_STATUS.md).
- **Known limitations or incomplete features:** Self-hosted, operator-only. One live Devin repair verified (one fault, Chromium). Verification supports Node.js servers without runtime dependencies. AI analysis and Fault DNA graphs are not implemented. See [PHASE_STATUS.md](PHASE_STATUS.md).
- **Libraries, APIs, and public datasets used:** See `package.json` files. TODO: attribution list.
- **AI usage record:** [AI_USAGE.md](AI_USAGE.md)
- **Development change log:** [CHANGELOG.md](CHANGELOG.md)

## Submission checklist

Left unticked on purpose. The Git history starts on 2026-10-24, after the event window in [RULES.md](RULES.md) (10–11 October 2026). The owner must decide which items are true.

- [ ] The project implementation started from scratch at the event.
- [ ] I participated solo or with no more than 4 team members in total.
- [ ] Codex was used during development and its usage is documented.
- [ ] The code repository URL, short description, and working demo are provided.
- [ ] README setup and demo instructions match the submitted code.
- [ ] Actual checks and known limitations are documented.
- [ ] Meaningful changes are documented and committed throughout development.
- [ ] The final implementation is committed and pushed, and its SHA is recorded above.
- [ ] No credentials or private data are included in the repository or demo instructions.
- [ ] The organizers' announced submission method and timing have been followed.
