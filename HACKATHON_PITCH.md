# FAULTLINE — pitch

**Break it. Understand it. Fix it. Prove it.**

Devin Hacks Kochi, Track 2: "Make the invisible visible". Three minutes. The click route and fallbacks are in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## One sentence

FAULTLINE breaks one dependency of your web app at a time in a real browser, shows exactly which user steps fail, hands the evidence to Devin, and then proves on its own whether the fix works.

## Script

### 1. Hook (20 s)

"CI was green. Checkout still died for everyone whose inventory call failed. Nobody saw it, because it worked on every laptop in the office."

*(Screen: the Northwind Supply storefront on :4600, healthy. Say it is our own reference shop, built with realistic flaws.)*

### 2. Break (40 s)

*(Blast Radius Map of the shop.)* "FAULTLINE ran the real checkout journey in Chromium, then broke one dependency at a time. One red line: `GET /api/inventory`. A side detail, and one 503 there takes down steps 2 to 8."

*(Blast Radius Map of the Daluxe project, the `localhost:8081` card.)* "And on a store I shipped for a real client, FAULTLINE found the production site calling `localhost:8081` from customers' browsers."

### 3. Understand (30 s)

*(Finding page: Reality Split, then the evidence timeline, then the regression test.)* "Left is the normal run, right is the run with inventory failing. Every pixel comes from a recorded execution. FAULTLINE turns the finding into a Playwright test. This test fails today. It's the contract for the fix."

### 4. Fix (40 s)

*(Repair page stepper.)* "A human approved this exact evidence package, checksum-locked, at 00:59. FAULTLINE opened one real Devin session." *(Devin session tab.)* "Devin reproduced it and opened PR #1 four minutes later." *(PR tab, scroll to FAULTLINE's comment.)* "And here is FAULTLINE's verdict, posted on the PR."

### 5. Prove (40 s)

*(Repair page, Independent verification.)* "FAULTLINE downloaded the exact commit, `b750bd3`, ran it in a container with no network, and ran our unchanged test. Original: 0 of 2. Devin's commit: 2 of 2 under the same fault. VERIFIED FIXED, for this journey."

*(Scroll to Cross-checks, then the second PR comment.)* "Then I tightened the journey with one assertion Devin's PR admitted it didn't handle. Same commit: STILL FAILING. Devin said fixed; FAULTLINE says not yet. That's why it never merges."

### 6. Close (10 s)

"AI can write the fix. FAULTLINE proves whether it works."

## For a non-technical judge

"We pull the plug on one small part of a website and watch what breaks, like a fire drill. Then an AI engineer repairs it, and we run the same fire drill again to prove the repair works."

## Facts behind every line

| Line | Record |
|---|---|
| Inventory takes down steps 2–8 | Analysis `780cac26…`, experiment `5f64dd02…` |
| Approval at 00:59, Devin session, PR #1 four minutes later | [FINAL_VERIFICATION_REPORT.md](FINAL_VERIFICATION_REPORT.md) §2–3 |
| 0 of 2 → 2 of 2, byte-identical healthy path | Run `39c125f0…` |
| Verdict on the PR | https://github.com/Invinciblx777/faultline-reference-shop/pull/1#issuecomment-6389303315 |
| STILL FAILING with the stricter journey | Cross-check run `24f9f532…`; second comment on PR #1 (link in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md), tab H) |
| Client store calls `http://localhost:8081` from visitors' browsers | Project `13327180…`, dependency `origin http://localhost:8081` in analyses `004f212e…`, `e24a90ca…`, `83758bb7…` |
| Client store at 360 px: RESILIENT | Analysis `83758bb7…`, experiment `921abd8d…` (journey v2) |

Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).
