# Demo runbook

Three minutes, click by click. The words to say are in [HACKATHON_PITCH.md](HACKATHON_PITCH.md); every ID is in [FINAL_VERIFICATION_REPORT.md](FINAL_VERIFICATION_REPORT.md).

The storefront is **Northwind Supply**, our own reference shop (`Invinciblx777/faultline-reference-shop`). The second project is **Daluxe Official**, a live store we built for a client, scanned read-only. Say which is which.

**Backup video:** [`docs/demo/faultline-walkthrough.webm`](docs/demo/faultline-walkthrough.webm), 2 min 39 s, 1366×768, captions, no audio, 22.4 MB. Recorded on 2026-10-25 at 04:17 IST on the Material 3 Expressive interface from a clean browser context; `pnpm demo:preflight` passed 10 of 10 at 04:20 IST. It follows the route below, tabs A to E (F, G and H are GitHub and Devin pages).

## 10 minutes before

1. From the repository root, start each process in its own terminal:

   ```bash
   podman-compose up -d                                  # PostgreSQL and MinIO
   pnpm reference-target                                 # storefront :4600, partner :4601
   GITHUB_TOKEN=$(gh auth token) pnpm start:worker
   GITHUB_TOKEN=$(gh auth token) pnpm start:web          # http://localhost:3000
   ```

   If code changed since the last build, run `pnpm build` first. `GITHUB_TOKEN` stays in the process environment and is never written to `.env`.

2. Run the preflight. Every line must say PASS:

   ```bash
   GITHUB_TOKEN=$(gh auth token) pnpm demo:preflight
   ```

   It checks PostgreSQL, pending migrations, MinIO, the worker heartbeat, podman, a Chromium launch, the web app, the storefront, GitHub, and Devin (`GET /v3/self` only, no session). It prints the demo URLs below from the database. Exit code 1 means do not present yet.

3. In the presenting browser, sign in to FAULTLINE as `phase3-demo`, to GitHub, and to Devin.
4. Open these tabs in order:

   | Tab | URL |
   |---|---|
   | A | http://localhost:4600/shop/ |
   | B | http://localhost:3000/scans/780cac26-dc0d-46be-84cf-0032f04646f6/blast-radius |
   | C | http://localhost:3000/scans/83758bb7-4a37-41cf-afdd-b2b73c3f020c/blast-radius |
   | D | http://localhost:3000/scans/780cac26-dc0d-46be-84cf-0032f04646f6/experiments/5f64dd02-32d0-485e-8e94-5ffcbac309b2 |
   | E | http://localhost:3000/repairs/268eeabb-af9e-4b86-828b-fbcf065f2a88 |
   | F | https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389303315 |
   | G | https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a |
   | H | https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389982815 |

5. Have the video open in a player, paused at 0:00.

## The route

| Time | Tab | Click | Beat |
|---|---|---|---|
| 0:00 | A | Scroll the product list and the checkout | Hook |
| 0:20 | B | Point at the BROKEN / RESILIENT counts. Hover the **GET /api/inventory** card; the lines show the steps it broke | Break |
| 0:40 | C | Point at the **localhost:8081** card: "Production site requests http://localhost:8081 from visitors' browsers (development endpoint shipped to production)." The 360×740 card next to it is RESILIENT | Break (real app) |
| 1:00 | D | Show **BROKEN · Reproduced**. Scroll to **Reality Split** and drag the seam. Scroll to the timeline, then to **Regression test** | Understand |
| 1:30 | E | Show the stepper (Finding → Evidence → Approval → Devin session → Pull request → Verification → Verdict) and **Approved by phase3-demo** | Fix |
| 1:45 | G | Show the session | Fix |
| 1:55 | F | Show FAULTLINE's comment on PR #1: table, screenshots, footer | Fix |
| 2:10 | E | **Verified fix report**: scope line. Scroll to **Independent verification**: Before/After, VERIFIED FIXED | Prove |
| 2:25 | E | Scroll to **Cross-checks**: **STILL FAILING**, step 3, `Received: enabled`; Camp Bottle has an enabled **Add to cart** | Prove |
| 2:40 | H | PR #1 now shows both verdicts in order: VERIFIED FIXED (v1), then STILL FAILING (journey v2), with the agent-stated limitation it tests | Prove |
| 2:50 | — | Close | Close |

## Optional: verify again live (about 60 s, no Devin cost)

On tab E, **Verify again commit b750bd308837** queues a new independent run of the same commit. It downloads from GitHub, so it needs internet. The page updates live. Use it only with time to spare. The result is whatever the run produces.

## Fallbacks

| Problem | Do this |
|---|---|
| Venue Wi-Fi drops | Switch the laptop to the phone hotspot. Tabs A–E are local and work offline; F and G need internet. Without any connection, skip F and G: tab E shows the PR, the session, and the comment link from stored data |
| Worker dies (preflight: Worker heartbeat FAIL) | `GITHUB_TOKEN=$(gh auth token) pnpm worker:restart` (rebuilds and starts the worker), then `pnpm demo:preflight`. The route itself only reads stored records, so tabs A–E still render without a worker |
| Web app down | `GITHUB_TOKEN=$(gh auth token) pnpm start:web` |
| Database schema FAIL | `pnpm db:migrate`, then restart web and worker |
| GitHub or Devin asks for login | Show the same facts on tab E |
| Anything else, or less than a minute to fix | Play [`docs/demo/faultline-walkthrough.webm`](docs/demo/faultline-walkthrough.webm) and narrate over it |

## Do not

- Do not approve a new repair on stage. Approval starts a paid Devin session.
- Do not merge PR #1. Merging is the repository owner's decision.
- Do not present the `faultline-verification-fixture` branch (`b7cc293`) as Devin's work. It is a developer test control.
- Do not launch new analyses of the Daluxe store on stage. It is a live production site; show the stored analyses.
