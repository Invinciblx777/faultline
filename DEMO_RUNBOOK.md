# Demo runbook

A rehearsable, click-by-click route through FAULTLINE for a three-minute judge demo. The route uses the persisted, genuine records of the live run on 2026-10-25. See [FINAL_VERIFICATION_REPORT.md](FINAL_VERIFICATION_REPORT.md) for every ID and hash.

The storefront is **Northwind Supply**, our own controlled reference application (`Invinciblx777/faultline-reference-shop`, private). Say so when you show it. It is not a customer's site.

## Before the demo (10 minutes ahead)

1. Start the stack from the FAULTLINE repository root, each process in its own terminal:

   ```bash
   podman-compose up -d                     # PostgreSQL and MinIO
   pnpm reference-target                    # storefront on :4600, partner on :4601
   GITHUB_TOKEN=$(gh auth token) pnpm start:worker
   GITHUB_TOKEN=$(gh auth token) pnpm start:web      # http://localhost:3000
   ```

   If the code changed since the last build, run `pnpm build` first. `GITHUB_TOKEN` stays in the process environment and is never written to `.env`.

2. Check health: `curl -s http://localhost:3000/api/health` returns `{"ok":true}`. The worker log shows `chromium preflight ok` and `repair integration … devin: configured`.
3. In the presenting browser, sign in to FAULTLINE as `phase3-demo`. Also sign in to GitHub (the shop repository is private) and to Devin (app.devin.ai), so the PR and session links open.
4. Open these tabs in order:
   - A: http://localhost:4600/shop/
   - B: http://localhost:3000/scans/780cac26-dc0d-46be-84cf-0032f04646f6/blast-radius
   - C: http://localhost:3000/scans/780cac26-dc0d-46be-84cf-0032f04646f6/experiments/5f64dd02-32d0-485e-8e94-5ffcbac309b2
   - D: http://localhost:3000/repairs/268eeabb-af9e-4b86-828b-fbcf065f2a88
   - E: https://github.com/Invinciblx777/faultline-reference-shop/pull/1/files
   - F: https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a
5. Optional terminal for the live failing test: copy the regression test from tab C (**Download regression test**) to a scratch folder that can resolve `@playwright/test`.

## The route (about 3 minutes)

| Time | Tab | Click / action | Say |
|---|---|---|---|
| 0:00 | A | Show the storefront: products, cart, checkout | "This shop looks healthy on a normal connection. But what happens if one API fails?" |
| 0:20 | B | Point at the summary chips (BROKEN 5, RESILIENT 3) and the map. Hover the `GET /api/inventory` card to show its links into the journey steps | "FAULTLINE ran the real checkout journey in Chromium, then broke one dependency at a time. Each line is a step that broke. Inventory is a side detail, yet one 503 there takes down steps 2 to 8." |
| 0:45 | C | Show the BROKEN · Reproduced 2/2 header and the step reasons. Scroll to **Reality Split**: drag the seam or switch to pixel diff | "This is not a guess. Left is the baseline run, right is the run with inventory failing. Every pixel comes from a recorded execution." |
| 1:05 | C | Scroll to **Regression test**. Optional: run it in the terminal against :4600 (`FAULTLINE_TARGET_URL=http://localhost:4600 npx playwright test <file>`). It fails in about 6 s | "FAULTLINE turns the finding into an executable Playwright test. It fails today, and that test is the contract for the fix." |
| 1:25 | D | Show the stepper: Finding → Evidence → Approval → Devin session → Pull request → Verification → Verdict | "A human approved spending on this exact evidence package, checksum-locked. Then FAULTLINE created one Devin session." |
| 1:40 | F | Open the Devin session | "Devin got the evidence and the rules, reproduced the bug, and fixed it in about four minutes." |
| 1:55 | E | Show `shop.js`: `Promise.all` → `Promise.allSettled`, stock shown as unavailable | "Devin's PR: the catalog no longer dies with inventory. But Devin saying it works is not proof." |
| 2:10 | D | Scroll to **Independent verification**. Show Before/After screenshots and the check list | "FAULTLINE downloaded the exact commit, ran it in a locked-down container, and ran *our* unchanged test. Original: fails 2 of 2. Devin's commit: passes 2 of 2 under the same fault, and the normal journey is unchanged." |
| 2:35 | D | Scroll up to the **Verified fix report**, VERIFIED FIXED | "Break it, understand it, fix it, prove it. The verdict is ours, bound to commit `b750bd3`." |
| 2:50 | — | Close | "Devin proposes the repair. FAULTLINE proves whether it works." |

## Optional live step: verify again (60 seconds, no Devin cost)

On tab D, **Verify again commit b750bd308837** queues a new independent run of the same commit. It takes about 60 s and needs internet access to download the GitHub archives. The page updates live. Use it only with time to spare. The earlier run stays on record either way. The result is whatever the run produces; it is not guaranteed to match.

## Fallbacks

| Problem | Do this |
|---|---|
| No internet | Tabs A–D work from the local database and MinIO. Skip E and F, and show the PR and session IDs on the verified report instead. Do not run "Verify again" (it downloads from GitHub) |
| Devin or GitHub page asks for login | Show the same facts on tab D: PR card (GitHub data stored at confirmation) and session card |
| Web app down | `GITHUB_TOKEN=$(gh auth token) pnpm start:web`. Screenshots of every screen are in [`docs/screenshots/`](docs/screenshots) |
| Reality Split images slow to load | Show [`docs/screenshots/05-storefront-original-under-fault.png`](docs/screenshots/05-storefront-original-under-fault.png) and [`06-storefront-candidate-under-fault.png`](docs/screenshots/06-storefront-candidate-under-fault.png); their SHA-256 values match the stored evidence |

## Do not

- Do not approve a new repair during the demo unless you intend to start another paid Devin session.
- Do not merge PR #1 on stage. Merging is a separate decision for the repository owner.
- Do not present the `faultline-verification-fixture` branch (`b7cc293`) as Devin's work. Developers wrote it as a test fixture.
- Do not describe the storefront as a customer's site.
