# Roadmap

These are next steps. They are not built yet. What runs today is in the [README](../README.md).

- **More stacks for verification.** Today a candidate commit must be a Node.js server without runtime dependencies. Next: dependency installation in a pinned, offline cache; static sites; container-image recipes.
- **Preview deployments.** Verify a pull request's preview URL as well as a local container build, with the preview origin added to the allowlist per run.
- **Fault DNA.** Each event already has a stable `(execution_id, seq)` identity. A graph could link faults, page reactions, and failed checks across analyses, to show which dependencies share a failure mode.
- **AI analysis.** An adapter that reads the exported report and proposes hypotheses that must cite event and artifact IDs (contract: `AiAnalysisAdapter` in `packages/shared/src/contracts`). It would never decide verdicts.
- **Revision loop.** When a verdict is STILL FAILING or REGRESSION DETECTED, prepare a follow-up request with the failed checks for the operator to approve as a new, separately approved session.
- **More browsers and devices.** WebKit and Firefox runs, and real-device runs, alongside Chromium.
- **Team features.** Per-project roles, approval policies with spending limits, and retention jobs for evidence.
- **Scheduled resilience checks.** Re-run a journey's experiments on a schedule and alert when a RESILIENT dependency becomes BROKEN.
