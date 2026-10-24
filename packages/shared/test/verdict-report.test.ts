import { describe, expect, it } from "vitest";
import { buildVerdictComment, extractAgentLimitations, healthyScreenshotsIdentical, verdictCommentMarker, verdictScope, type VerdictCheck } from "../src/verdict-report";

const SAME = "4".repeat(64);
const checks: VerdictCheck[] = [
  { stage: "original-normal", purpose: "verdict", status: "passed", screenshotSha256: SAME },
  { stage: "original-fault", purpose: "verdict", status: "failed", screenshotSha256: null },
  { stage: "original-fault", purpose: "verdict", status: "failed", screenshotSha256: null },
  { stage: "original-fault-evidence", purpose: "evidence", status: "failed", screenshotSha256: "1".repeat(64) },
  { stage: "candidate-fault", purpose: "verdict", status: "passed", screenshotSha256: null },
  { stage: "candidate-fault", purpose: "verdict", status: "passed", screenshotSha256: null },
  { stage: "candidate-fault-evidence", purpose: "evidence", status: "passed", screenshotSha256: "d".repeat(64) },
  { stage: "candidate-normal", purpose: "verdict", status: "passed", screenshotSha256: SAME },
];

describe("verdict scope", () => {
  it("states exactly what VERIFIED FIXED covers", () => {
    expect(verdictScope("verified_fixed", true)).toBe(
      "VERIFIED FIXED: the original failing regression test passes under the identical injected fault, and the healthy-path journey passes with a byte-identical screenshot. This verdict covers the tested journey and assertions only; it is not a claim that the change is correct in all respects. FAULTLINE never merges.",
    );
  });

  it("never claims byte-identical screenshots unless the hashes match", () => {
    expect(verdictScope("verified_fixed", false)).not.toContain("byte-identical");
    expect(healthyScreenshotsIdentical(checks)).toBe(true);
    expect(healthyScreenshotsIdentical(checks.map((c) => (c.stage === "candidate-normal" ? { ...c, screenshotSha256: "e".repeat(64) } : c)))).toBe(false);
    expect(healthyScreenshotsIdentical(checks.map((c) => ({ ...c, screenshotSha256: null })))).toBe(false);
  });

  it("scopes every other verdict too", () => {
    expect(verdictScope("regression_detected", false)).toMatch(/^REGRESSION DETECTED: .*tested journey and assertions only/);
  });
});

describe("agent-stated limitations", () => {
  const body = [
    "## Summary",
    "- not a limitation",
    "",
    "## Known limitations",
    "- While stock is unknown, all products can be added to the cart,",
    "  including ones that are out of stock. token=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "- The regression test file is not committed.",
    "",
    "Link to Devin session: https://app.devin.ai/sessions/x",
    "## Next",
    "- ignored",
  ].join("\n");

  it("quotes only the bullets under the limitations heading, joined and redacted", () => {
    const items = extractAgentLimitations(body);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/^While stock is unknown, all products can be added to the cart, including ones that are out of stock\./);
    expect(items[0]).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(items[1]).toBe("The regression test file is not committed.");
  });

  it("returns nothing without a limitations heading or body", () => {
    expect(extractAgentLimitations("## Summary\n- fixed it")).toEqual([]);
    expect(extractAgentLimitations(null)).toEqual([]);
  });

  it("accepts a paragraph instead of a list", () => {
    expect(extractAgentLimitations("### Limitations\nOnly Chromium was tested.\n")).toEqual(["Only Chromium was tested."]);
  });
});

describe("verdict comment", () => {
  const input = {
    repairId: "268eeabb-af9e-4b86-828b-fbcf065f2a88",
    runId: "39c125f0-ca3c-4e33-afb5-ae5c03430097",
    verdict: "verified_fixed" as const,
    originalSha: "6".repeat(40),
    candidateSha: "b".repeat(40),
    checks,
    startedAt: new Date("2026-10-24T19:37:30Z"),
    finishedAt: new Date("2026-10-24T19:38:30Z"),
    durationMs: 59_629,
    browser: "Chromium 156.0.8078.4 (Playwright 1.64.1)",
    containerRuntime: "podman version 5.8.9",
    journeyName: "Buy a backpack",
    journeyStepCount: 8,
    fault: "Requests to GET /api/inventory receive an injected HTTP 503 response",
    regressionTest: { filename: "test.spec.ts", sha256: "c".repeat(64) },
    agentLimitations: ["Out-of-stock items can be added while inventory is down."],
  };

  it("carries the verdict, scope, counts, agent limitation, run facts, and the idempotency marker", () => {
    const md = buildVerdictComment(input);
    expect(md.startsWith(verdictCommentMarker(input.repairId, input.runId))).toBe(true);
    expect(md).toContain("## FAULTLINE verification — VERIFIED FIXED");
    expect(md).toContain(`> ${verdictScope("verified_fixed", true)}`);
    expect(md).toContain(`| Original (base) | \`${input.originalSha}\` | failed 2/2 | passed |`);
    expect(md).toContain(`| Candidate (this PR) | \`${input.candidateSha}\` | passed 2/2 | passed (screenshot byte-identical to the original) |`);
    expect(md).toContain("> Out-of-stock items can be added while inventory is down.");
    expect(md).toContain("- Verification run: `39c125f0-ca3c-4e33-afb5-ae5c03430097`");
    expect(md).toContain("2026-10-24 19:37:30 UTC to 2026-10-24 19:38:30 UTC (59.6 s)");
    expect(md).toContain("Chromium 156.0.8078.4 (Playwright 1.64.1)");
    expect(md).toContain('Journey: "Buy a backpack" (8 steps)');
    expect(md).toContain("Posted by FAULTLINE. Verdict determined by an independent browser run, not by the agent.");
    expect(md).toContain("(aside)");
  });

  it("links screenshots only when a public URL is given, and lists hashes otherwise", () => {
    expect(buildVerdictComment(input)).not.toContain("![");
    const md = buildVerdictComment({ ...input, imageUrl: (sha) => `https://example.test/${sha}.png` });
    expect(md).toContain(`![Original commit under the injected fault](https://example.test/${"1".repeat(64)}.png)`);
    expect(md).toContain(`![Candidate commit under the injected fault](https://example.test/${"d".repeat(64)}.png)`);
  });
});
