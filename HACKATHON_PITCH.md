# FAULTLINE — hackathon pitch

**Break it. Understand it. Fix it. Prove it.**

Devin Hacks Kochi, Track 2: "Make the invisible visible". About three minutes. The click route is in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## One sentence

FAULTLINE breaks a web app on purpose in a real browser, shows exactly what failed, asks Devin to fix it, and then proves on its own whether the fix works.

## The problem (30 seconds)

Most apps are tested on a good connection with every API up. Real users hit slow networks, failing services, and offline moments. Those failures are invisible until customers find them. When an AI agent then says "fixed", that is still only a claim.

## What we built (60 seconds)

1. **Break it.** FAULTLINE runs a real user journey in Chromium, finds the app's dependencies from real traffic, then fails them one at a time: errors, outages, slowness, offline, small screens.
2. **Understand it.** The **Blast Radius Map** links each failed dependency to the exact journey steps it broke. **Reality Split** puts the normal and broken runs side by side, pixel for pixel. Every finding becomes an executable Playwright regression test.
3. **Fix it.** With one human approval, tied to a checksum of the evidence, FAULTLINE sends the evidence package to a Devin session. Devin opens a pull request.
4. **Prove it.** FAULTLINE downloads the pull request's **exact commit** and runs it in a locked-down container. It runs its **own unchanged test** against both the original and the fix. Only that produces a verdict: VERIFIED FIXED, STILL FAILING, REGRESSION DETECTED, INCONCLUSIVE, or BLOCKED.

## The proof we will show (live records from 2026-10-25)

Our controlled reference storefront (our own app, built to have realistic flaws) looks fine on a normal connection.

- When `GET /api/inventory` returns a 503, **the whole product list disappears** and checkout is impossible. The cause is `Promise.all` in `shop.js`.
- FAULTLINE found this, reproduced it twice, and generated a failing test.
- An operator approved one Devin session (`60a680e3…`). About four minutes later, Devin opened **PR #1** with a graceful-degradation fix and its own tests.
- FAULTLINE then verified commit `b750bd3`:
  - The original failed the test 2 of 2 times.
  - Devin's commit passed 2 of 2 under the same fault.
  - The normal journey still passed, with a byte-identical screenshot.
- **Verdict: VERIFIED FIXED.**

## Why it matters

- **Evidence, not vibes.** Every screenshot, error, and verdict comes from a recorded browser execution, with SHA-256 hashes.
- **AI-agnostic trust.** Devin proposes, and FAULTLINE verifies. The agent cannot edit the test that judges it.
- **Safe by design.** Targets are allowlisted, every spend needs explicit human approval, and candidate code runs only in a sandbox without egress. FAULTLINE never merges.

## For a non-technical judge

"We pull the plug on one small part of a website and watch what breaks, like a fire drill. Then an AI engineer repairs it, and we run the same fire drill again to prove the repair works. No trust needed, just evidence."

## Honest scope

- One live repair has been verified, on our own reference app, for one fault in Chromium. Other findings on that app are not yet repaired.
- Verification currently supports Node.js servers without runtime dependencies.
- Self-hosted, operator-only. Not deployed publicly.

Longer-term ideas are in [docs/vision.md](docs/vision.md).
