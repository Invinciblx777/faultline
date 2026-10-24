import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { buildVerdictComment, describeFault, verdictCommentMarker } from "@faultline/shared";
import { GitHubApiError, type GitHubClient } from "@faultline/shared/integrations";
import type { Database } from "./client";
import { recordRepairEvent } from "./repairs";
import { experiments, regressionTests, repairRequests, scans, verificationChecks, verificationRuns, workerInstances } from "./schema";

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

/**
 * Which run to describe. Without `runId`, the repair's latest completed verification.
 * With `runId`, any completed run of the repair, including a cross-check, which is judged
 * by another finding's journey and regression test.
 */
export interface VerdictCommentOptions {
  runId?: string;
  /** Short qualifier after the verdict in the heading, e.g. "journey v2: out-of-stock guard". */
  titleDetail?: string | null;
  /** 1-based positions of the agent-stated limitations this run tests; only those are quoted. */
  testedLimitations?: number[];
}

/** Markdown for one completed verification run of a repair, or an error when there is no verdict yet. */
export async function buildRepairVerdictComment(db: Database, repairId: string, imageUrl?: (sha256: string) => string | null, options: VerdictCommentOptions = {}) {
  const [repair] = await db.select().from(repairRequests).where(eq(repairRequests.id, repairId));
  if (!repair) return { ok: false as const, error: "Repair not found." };
  const runId = options.runId ?? repair.latestVerificationId;
  if (!runId || (!options.runId && !repair.verdict)) return { ok: false as const, error: "This repair has no verification verdict yet." };
  const [run] = await db.select().from(verificationRuns).where(and(eq(verificationRuns.id, runId), eq(verificationRuns.repairId, repair.id)));
  if (!run) return { ok: false as const, error: "That verification run does not belong to this repair." };
  if (run.status !== "completed" || !run.verdict) return { ok: false as const, error: "That verification run has not completed." };
  const checks = await db.select().from(verificationChecks).where(eq(verificationChecks.runId, run.id)).orderBy(asc(verificationChecks.ordinal));
  const [worker] = run.workerId ? await db.select().from(workerInstances).where(eq(workerInstances.id, run.workerId)) : [];
  const browser = worker?.browserVersion ? `Chromium ${worker.browserVersion}${worker.playwrightVersion ? ` (Playwright ${worker.playwrightVersion})` : ""}` : null;
  const runtime = typeof run.builds?.runtime === "string" ? run.builds.runtime : null;

  let journey = { name: repair.evidence.journey.name, steps: repair.evidence.journey.steps.length };
  let fault = repair.evidence.finding.fault;
  let regressionTest = { filename: repair.evidence.regressionTest.filename, sha256: repair.regressionTestSha256 };
  if (run.crossCheckExperimentId || run.crossCheckRegressionTestId) {
    // A cross-check is judged by another finding: describe that finding's journey, fault, and test.
    const [experiment] = run.crossCheckExperimentId ? await db.select().from(experiments).where(eq(experiments.id, run.crossCheckExperimentId)) : [];
    const [scan] = experiment ? await db.select({ snapshot: scans.journeySnapshot }).from(scans).where(eq(scans.id, experiment.scanId)) : [];
    const [test] = run.crossCheckRegressionTestId ? await db.select().from(regressionTests).where(eq(regressionTests.id, run.crossCheckRegressionTestId)) : [];
    if (!experiment || !scan?.snapshot || !test) return { ok: false as const, error: "The cross-check's finding or regression test is no longer stored." };
    journey = { name: `${scan.snapshot.definition.name} v${scan.snapshot.version}`, steps: scan.snapshot.definition.steps.length };
    fault = describeFault(experiment.fault, experiment.dependencyLabel);
    regressionTest = { filename: test.filename, sha256: run.regressionTestSha256 };
  }
  const limitations = options.testedLimitations
    ? options.testedLimitations.map((n) => repair.prAgentLimitations[n - 1]).filter((item): item is string => typeof item === "string")
    : repair.prAgentLimitations;
  if (options.testedLimitations && limitations.length !== options.testedLimitations.length) {
    return { ok: false as const, error: `The pull request states ${repair.prAgentLimitations.length} limitations; pick from 1 to ${repair.prAgentLimitations.length}.` };
  }

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
    journeyName: journey.name,
    journeyStepCount: journey.steps,
    fault,
    regressionTest,
    agentLimitations: limitations,
    limitationsTested: Boolean(options.testedLimitations),
    titleDetail: options.titleDetail ?? null,
    imageUrl,
  });
  return { ok: true as const, repair, run, markdown };
}

export async function postVerificationComment(
  db: Database,
  github: GitHubClient,
  repairId: string,
  options: VerdictCommentOptions & { imageUrl?: (sha256: string) => string | null; operatorId?: string | null } = {},
): Promise<VerdictCommentResult> {
  const built = await buildRepairVerdictComment(db, repairId, options.imageUrl, options);
  if (!built.ok) return { ok: false, error: built.error, markdown: null, httpStatus: null };
  const { repair, run, markdown } = built;
  // The repair's comment columns track its own verdict; a comment for another run (a cross-check) is recorded as an event only.
  const ownVerdict = run.id === repair.latestVerificationId;
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
      .set(
        ownVerdict
          ? { verdictCommentId: comment.id, verdictCommentUrl: comment.html_url, verdictCommentRunId: run.id, verdictCommentPostedAt: new Date(), verdictCommentClaimedAt: null }
          : { verdictCommentClaimedAt: null },
      )
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
