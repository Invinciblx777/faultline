import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { buildVerdictComment, verdictCommentMarker } from "@faultline/shared";
import { GitHubApiError, type GitHubClient } from "@faultline/shared/integrations";
import type { Database } from "./client";
import { recordRepairEvent } from "./repairs";
import { repairRequests, verificationChecks, verificationRuns, workerInstances } from "./schema";

/**
 * FAULTLINE's verdict comment on the repair's pull request. One comment per
 * verification run: a stored comment ID, then a marker search on GitHub,
 * are both checked before anything is posted, so retries and double clicks
 * never post twice.
 */

export type VerdictCommentResult =
  | { ok: true; created: boolean; commentId: number; url: string; markdown: string }
  | { ok: false; error: string; markdown: string | null; httpStatus: number | null };

const CLAIM_TTL_MS = 2 * 60_000;

/** Markdown for the repair's latest completed verification, or an error when there is no verdict yet. */
export async function buildRepairVerdictComment(db: Database, repairId: string, imageUrl?: (sha256: string) => string | null) {
  const [repair] = await db.select().from(repairRequests).where(eq(repairRequests.id, repairId));
  if (!repair) return { ok: false as const, error: "Repair not found." };
  if (!repair.verdict || !repair.latestVerificationId) return { ok: false as const, error: "This repair has no verification verdict yet." };
  const [run] = await db.select().from(verificationRuns).where(eq(verificationRuns.id, repair.latestVerificationId));
  if (!run || run.status !== "completed" || !run.verdict) return { ok: false as const, error: "The latest verification run has not completed." };
  const checks = await db.select().from(verificationChecks).where(eq(verificationChecks.runId, run.id)).orderBy(asc(verificationChecks.ordinal));
  const [worker] = run.workerId ? await db.select().from(workerInstances).where(eq(workerInstances.id, run.workerId)) : [];
  const browser = worker?.browserVersion ? `Chromium ${worker.browserVersion}${worker.playwrightVersion ? ` (Playwright ${worker.playwrightVersion})` : ""}` : null;
  const runtime = typeof run.builds?.runtime === "string" ? run.builds.runtime : null;
  const markdown = buildVerdictComment({
    repairId: repair.id,
    runId: run.id,
    verdict: run.verdict,
    originalSha: run.originalSha,
    candidateSha: run.candidateSha,
    checks,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    browser,
    containerRuntime: runtime,
    journeyName: repair.evidence.journey.name,
    journeyStepCount: repair.evidence.journey.steps.length,
    fault: repair.evidence.finding.fault,
    regressionTest: { filename: repair.evidence.regressionTest.filename, sha256: repair.regressionTestSha256 },
    agentLimitations: repair.prAgentLimitations,
    imageUrl,
  });
  return { ok: true as const, repair, run, markdown };
}

export async function postVerificationComment(db: Database, github: GitHubClient, repairId: string, options: { imageUrl?: (sha256: string) => string | null; operatorId?: string | null } = {}): Promise<VerdictCommentResult> {
  const built = await buildRepairVerdictComment(db, repairId, options.imageUrl);
  if (!built.ok) return { ok: false, error: built.error, markdown: null, httpStatus: null };
  const { repair, run, markdown } = built;
  if (!repair.prNumber) return { ok: false, error: "This repair has no confirmed pull request.", markdown, httpStatus: null };
  if (repair.verdictCommentId && repair.verdictCommentUrl && repair.verdictCommentRunId === run.id) {
    return { ok: true, created: false, commentId: repair.verdictCommentId, url: repair.verdictCommentUrl, markdown };
  }
  if (!github.hasToken) return { ok: false, error: "GITHUB_TOKEN is not set, so FAULTLINE cannot comment. Paste the Markdown into the pull request instead.", markdown, httpStatus: null };

  const claimed = await db
    .update(repairRequests)
    .set({ verdictCommentClaimedAt: new Date() })
    .where(and(eq(repairRequests.id, repair.id), or(isNull(repairRequests.verdictCommentClaimedAt), lt(repairRequests.verdictCommentClaimedAt, new Date(Date.now() - CLAIM_TTL_MS)))))
    .returning({ id: repairRequests.id });
  if (!claimed.length) return { ok: false, error: "A verdict comment is already being posted for this repair. Reload in a minute.", markdown, httpStatus: null };

  const save = async (comment: { id: number; html_url: string }, created: boolean) => {
    await db
      .update(repairRequests)
      .set({ verdictCommentId: comment.id, verdictCommentUrl: comment.html_url, verdictCommentRunId: run.id, verdictCommentPostedAt: new Date(), verdictCommentClaimedAt: null })
      .where(eq(repairRequests.id, repair.id));
    await recordRepairEvent(db, repair.id, {
      source: "faultline",
      kind: "verdict_comment",
      message: `${created ? "Posted" : "Found"} FAULTLINE's verdict comment for verification ${run.id.slice(0, 8)} on pull request #${repair.prNumber}: ${comment.html_url}`,
      externalId: `verdict-comment:${run.id}`,
      operatorId: options.operatorId ?? null,
      detail: { commentId: comment.id, url: comment.html_url, runId: run.id },
    });
    return { ok: true as const, created, commentId: comment.id, url: comment.html_url, markdown };
  };

  try {
    // A previous attempt may have posted without recording it (timeout, crash): find it first.
    const marker = verdictCommentMarker(repair.id, run.id);
    const existing = (await github.listIssueComments(repair.repoOwner, repair.repoName, repair.prNumber)).find((c) => c.body?.includes(marker));
    if (existing) return await save(existing, false);
    const comment = await github.createIssueComment(repair.repoOwner, repair.repoName, repair.prNumber, markdown);
    return await save(comment, true);
  } catch (error) {
    await db.update(repairRequests).set({ verdictCommentClaimedAt: null }).where(eq(repairRequests.id, repair.id));
    const status = error instanceof GitHubApiError ? error.httpStatus : null;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not post the verdict comment: ${message}`, markdown, httpStatus: status };
  }
}
