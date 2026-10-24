import { sanitizeEvidenceText, VERIFICATION_VERDICT_DEFINITIONS, type VerificationVerdict } from "./repair";

/**
 * What a verification verdict does and does not cover, and the Markdown
 * record FAULTLINE posts on the pull request. Pure functions: callers pass
 * stored rows, nothing here reads the network or the database.
 */

const VERDICT_TITLES: Record<VerificationVerdict, string> = {
  verified_fixed: "VERIFIED FIXED",
  still_failing: "STILL FAILING",
  regression_detected: "REGRESSION DETECTED",
  inconclusive: "INCONCLUSIVE",
  verification_blocked: "VERIFICATION BLOCKED",
};

export function verdictTitle(verdict: VerificationVerdict): string {
  return VERDICT_TITLES[verdict];
}

const SCOPE_LIMIT = "This verdict covers the tested journey and assertions only; it is not a claim that the change is correct in all respects. FAULTLINE never merges.";

/**
 * One-line scope statement shown next to every verdict. "Byte-identical" is
 * only said when the two healthy-path screenshots really have the same hash.
 */
export function verdictScope(verdict: VerificationVerdict, healthyScreenshotIdentical: boolean): string {
  if (verdict === "verified_fixed") {
    const healthy = healthyScreenshotIdentical ? "the healthy-path journey passes with a byte-identical screenshot" : "the healthy-path journey passes";
    return `VERIFIED FIXED: the original failing regression test passes under the identical injected fault, and ${healthy}. ${SCOPE_LIMIT}`;
  }
  return `${VERDICT_TITLES[verdict]}: ${VERIFICATION_VERDICT_DEFINITIONS[verdict]} ${SCOPE_LIMIT}`;
}

export interface VerdictCheck {
  stage: string;
  purpose: string;
  status: string;
  screenshotSha256: string | null;
}

/** True when the original and candidate healthy-path runs produced the same screenshot bytes. */
export function healthyScreenshotsIdentical(checks: readonly VerdictCheck[]): boolean {
  const original = checks.find((c) => c.stage === "original-normal")?.screenshotSha256;
  const candidate = checks.find((c) => c.stage === "candidate-normal")?.screenshotSha256;
  return Boolean(original && candidate && original === candidate);
}

/**
 * Bullets under a "Limitations" or "Known limitations" heading in a pull
 * request description. The agent wrote them; FAULTLINE only quotes them.
 */
export function extractAgentLimitations(body: string | null | undefined, max = 5): string[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+(known\s+)?limitations?\b/i.test(line.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (/^#{1,6}\s/.test(text)) break;
    const bullet = /^[-*+]\s+(.*)$/.exec(text);
    if (bullet) {
      if (current) items.push(current);
      current = bullet[1] ?? "";
    } else if (!text) {
      if (current) items.push(current);
      current = null;
    } else if (current !== null) {
      current += ` ${text}`;
    } else if (!items.length) {
      // A plain paragraph instead of a list.
      current = text;
    }
  }
  if (current) items.push(current);
  return items.slice(0, max).map((item) => sanitizeEvidenceText(item, 600));
}

export interface VerdictCommentInput {
  repairId: string;
  runId: string;
  verdict: VerificationVerdict;
  originalSha: string;
  candidateSha: string;
  checks: readonly VerdictCheck[];
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  /** e.g. "Chromium 156.0.8078.4 (Playwright 1.64.1)"; null when the worker did not record it. */
  browser: string | null;
  containerRuntime: string | null;
  journeyName: string;
  journeyStepCount: number;
  fault: string;
  regressionTest: { filename: string; sha256: string };
  agentLimitations: readonly string[];
  /** Public URL for a screenshot by its SHA-256, or null to list the hash only. */
  imageUrl?: (sha256: string) => string | null;
}

/** Hidden marker that lets a retry find a comment it already posted instead of posting twice. */
export function verdictCommentMarker(repairId: string, runId: string): string {
  return `<!-- faultline-verdict repair=${repairId} run=${runId} -->`;
}

function tally(checks: readonly VerdictCheck[], stage: string, status: string): string {
  const runs = checks.filter((c) => c.stage === stage && c.purpose === "verdict");
  if (!runs.length) return "not run";
  return `${status} ${runs.filter((c) => c.status === status).length}/${runs.length}`;
}

function single(checks: readonly VerdictCheck[], stage: string): string {
  return checks.find((c) => c.stage === stage)?.status ?? "not run";
}

function iso(date: Date | null): string {
  return date ? `${date.toISOString().replace("T", " ").slice(0, 19)} UTC` : "unknown";
}

export function buildVerdictComment(input: VerdictCommentInput): string {
  const identical = healthyScreenshotsIdentical(input.checks);
  const title = VERDICT_TITLES[input.verdict];
  const lines: string[] = [verdictCommentMarker(input.repairId, input.runId), `## FAULTLINE verification — ${title}`, "", `> ${verdictScope(input.verdict, identical)}`, ""];

  lines.push(
    "| Revision | Commit | Regression test under the fault | Healthy-path journey |",
    "|---|---|---|---|",
    `| Original (base) | \`${input.originalSha}\` | ${tally(input.checks, "original-fault", "failed")} | ${single(input.checks, "original-normal")} |`,
    `| Candidate (this PR) | \`${input.candidateSha}\` | ${tally(input.checks, "candidate-fault", "passed")} | ${single(input.checks, "candidate-normal")}${identical ? " (screenshot byte-identical to the original)" : ""} |`,
    "",
  );

  if (input.agentLimitations.length) {
    lines.push("**Agent-stated limitation** (quoted from this pull request's description; FAULTLINE did not test it):", "");
    for (const item of input.agentLimitations) lines.push(`> ${item}`, ">");
    lines.pop();
    lines.push("");
  }

  const original = input.checks.find((c) => c.stage === "original-fault-evidence")?.screenshotSha256 ?? null;
  const candidate = input.checks.find((c) => c.stage === "candidate-fault-evidence")?.screenshotSha256 ?? null;
  if (original || candidate) {
    const cell = (sha: string | null, alt: string) => {
      if (!sha) return "not captured";
      const url = input.imageUrl?.(sha);
      return url ? `![${alt}](${url})<br>SHA-256 \`${sha.slice(0, 16)}\`` : `SHA-256 \`${sha}\``;
    };
    lines.push(
      "| Original under the fault | Candidate under the fault |",
      "|---|---|",
      `| ${cell(original, "Original commit under the injected fault")} | ${cell(candidate, "Candidate commit under the injected fault")} |`,
      "",
    );
  }

  lines.push(
    "<details><summary>Run details</summary>",
    "",
    `- Verification run: \`${input.runId}\``,
    `- Ran: ${iso(input.startedAt)} to ${iso(input.finishedAt)}${input.durationMs !== null ? ` (${(input.durationMs / 1000).toFixed(1)} s)` : ""}`,
    `- Browser: ${input.browser ?? "not recorded"}, headless`,
    `- Journey: "${input.journeyName}" (${input.journeyStepCount} steps)`,
    `- Fault: ${input.fault}`,
    `- Regression test: \`${input.regressionTest.filename}\`, SHA-256 \`${input.regressionTest.sha256}\`, unchanged`,
    `- Isolation: each commit built from its GitHub archive in a container${input.containerRuntime ? ` (${input.containerRuntime})` : ""} with a read-only root, no capabilities, and no egress`,
    `- Repair request: \`${input.repairId}\``,
    "",
    "</details>",
    "",
    "---",
    "Posted by FAULTLINE. Verdict determined by an independent browser run, not by the agent.",
    // Devin skips PR comments containing "(aside)"; this record must not wake a paid session.
    "(aside) Automated verification record; no action is requested.",
  );
  return lines.join("\n");
}
