import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  isAssertionStep,
  REPAIR_SYNC_STATUSES,
  REPAIR_VERIFIABLE_STATUSES,
  describeStep,
  journeyDefinitionSchema,
  type RepairEvidenceInput,
  type RepairStatus,
  type VerificationVerdict,
} from "@faultline/shared";
import type { Database } from "./client";
import {
  artifacts,
  dependencies,
  executionEvents,
  experiments,
  networkRequests,
  projects,
  regressionTests,
  repairEvents,
  repairRequests,
  scanExecutions,
  scans,
  sourceRepositories,
  stepResults,
  verificationRuns,
  type RepairEventSource,
  type SourceRepository,
} from "./schema";

/**
 * Repair lifecycle transitions. Like scans, each transition is one
 * conditional UPDATE so a double click, a page reload, two workers, or the
 * stale sweeper cannot both win.
 */

export async function recordRepairEvent(
  db: Database,
  repairId: string,
  event: { source: RepairEventSource; kind: string; message: string; externalId?: string | null; occurredAt?: Date; operatorId?: string | null; detail?: Record<string, unknown> | null },
): Promise<boolean> {
  const rows = await db
    .insert(repairEvents)
    .values({
      repairId,
      source: event.source,
      kind: event.kind,
      message: event.message,
      externalId: event.externalId ?? null,
      occurredAt: event.occurredAt ?? new Date(),
      operatorId: event.operatorId ?? null,
      detail: event.detail ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: repairEvents.id });
  return rows.length > 0;
}

/** Collects the stored evidence of one finding into the builder's input. Returns an error message when the finding is not repairable. */
export async function loadRepairEvidenceInput(
  db: Database,
  experimentId: string,
  repository: SourceRepository,
  ids: { repairRequestId: string; createdAt: Date; baseSha: string | null },
): Promise<{ ok: true; input: RepairEvidenceInput; scanId: string; projectId: string; regressionTestId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select({ experiment: experiments, scan: scans, project: projects })
    .from(experiments)
    .innerJoin(scans, eq(scans.id, experiments.scanId))
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .where(eq(experiments.id, experimentId));
  if (!row) return { ok: false, error: "That finding does not exist." };
  const { experiment, scan, project } = row;
  if (experiment.verdict !== "broken" && experiment.verdict !== "degraded") return { ok: false, error: "Only BROKEN or DEGRADED findings can be sent for repair." };
  if (repository.projectId !== project.id) return { ok: false, error: "The linked repository belongs to a different project." };
  const [test] = await db.select().from(regressionTests).where(eq(regressionTests.experimentId, experimentId));
  if (!test) return { ok: false, error: "This finding has no generated regression test, so a repair could not be verified." };
  if (test.validationStatus !== "fails_as_expected") {
    return { ok: false, error: `The regression test was not validated as failing on the original site (status: ${test.validationStatus}). FAULTLINE only sends findings whose test reproduces the failure.` };
  }
  if (!scan.journeySnapshot || !scan.analysis) return { ok: false, error: "The analysis has no journey snapshot or summary." };
  const journey = journeyDefinitionSchema.parse(scan.journeySnapshot.definition);
  const firstNavigate = journey.steps.find((s) => s.type === "navigate");

  const executions = await db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id)).orderBy(asc(scanExecutions.createdAt));
  const baseline = executions.find((e) => e.role === "baseline");
  const firstAttempt = executions.find((e) => e.experimentId === experimentId && e.attempt === 1);
  if (!baseline || !firstAttempt) return { ok: false, error: "The baseline or the experiment's run is missing." };

  const [steps, events, injected, files, dependency] = await Promise.all([
    db.select().from(stepResults).where(inArray(stepResults.executionId, [baseline.id, firstAttempt.id])),
    db.select().from(executionEvents).where(eq(executionEvents.executionId, firstAttempt.id)).orderBy(asc(executionEvents.seq)).limit(400),
    db
      .select()
      .from(networkRequests)
      .where(and(eq(networkRequests.executionId, firstAttempt.id), sql`${networkRequests.injected} is not null and ${networkRequests.injected} <> 'mutation-blocked'`))
      .orderBy(asc(networkRequests.requestId))
      .limit(50),
    db.select().from(artifacts).where(and(inArray(artifacts.executionId, [baseline.id, firstAttempt.id]), eq(artifacts.kind, "screenshot"))),
    experiment.dependencyId ? db.select().from(dependencies).where(eq(dependencies.id, experiment.dependencyId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const journeySteps = (executionId: string) => steps.filter((s) => s.executionId === executionId && s.phase === "journey");

  const input: RepairEvidenceInput = {
    repairRequestId: ids.repairRequestId,
    createdAt: ids.createdAt.toISOString(),
    analysis: { scanId: scan.id, projectName: project.name, analyzedOrigin: project.origin, finishedAt: scan.finishedAt?.toISOString() ?? null },
    experiment: {
      id: experiment.id,
      verdict: experiment.verdict,
      reproducibility: experiment.reproducibility,
      fault: experiment.fault,
      dependencyLabel: experiment.dependencyLabel,
      reasons: experiment.reasons,
      affectedSteps: experiment.affectedSteps,
      newErrors: experiment.newErrors.map((e) => ({ kind: e.kind, message: e.message })),
      visualNote: experiment.visual?.note ?? null,
    },
    dependency: dependency
      ? {
          key: dependency.key,
          label: dependency.label,
          origin: dependency.origin,
          method: dependency.method,
          pathPattern: dependency.pathPattern,
          party: dependency.party,
          requestedDuringSteps: dependency.requestedDuringSteps.map((i) => i + 1),
          sampleUrls: dependency.sampleUrls,
        }
      : null,
    journey: {
      name: journey.name,
      version: scan.journeySnapshot.version,
      firstPath: firstNavigate?.type === "navigate" ? firstNavigate.path : "/",
      steps: journey.steps.map((step, index) => ({ index, description: describeStep(step), isAssertion: isAssertionStep(step) })),
      stableSteps: scan.analysis.stableSteps,
    },
    baselineSteps: journeySteps(baseline.id).map((s) => ({ index: s.stepIndex, status: s.status })),
    faultSteps: journeySteps(firstAttempt.id).map((s) => ({ index: s.stepIndex, status: s.status, error: s.error })),
    faultTimeline: events
      .filter((e) => e.severity !== "info" || e.kind === "fault_injected" || e.kind === "journey_step" || e.kind === "assertion")
      .map((e) => ({ offsetMs: e.offsetMs, kind: e.kind, severity: e.severity, message: e.message, url: e.url })),
    injectedRequests: injected.map((r) => ({ method: r.method, url: r.url, status: r.status, injected: r.injected!, stepIndex: r.stepIndex === null ? null : r.stepIndex + 1 })),
    artifacts: files.map((f) => ({
      id: f.id,
      run: f.executionId === baseline.id ? ("baseline" as const) : ("under-fault" as const),
      kind: f.kind,
      sha256: f.sha256,
      byteSize: f.byteSize,
      width: f.width,
      height: f.height,
    })),
    regressionTest: {
      id: test.id,
      filename: test.filename,
      sha256: test.sha256,
      content: test.content,
      command: test.command,
      validationStatus: test.validationStatus,
      validationSummary: test.validationSummary,
    },
    repository: {
      provider: "github",
      fullName: `${repository.owner}/${repository.name}`,
      url: repository.url,
      baseBranch: repository.baseBranch,
      baseSha: ids.baseSha,
      appDir: repository.appDir,
    },
  };
  return { ok: true, input, scanId: scan.id, projectId: project.id, regressionTestId: test.id };
}

/**
 * Explicit approval. Succeeds only once, only while awaiting approval, and
 * only for the evidence checksum the operator was shown.
 */
export async function approveRepair(db: Database, repairId: string, approval: { operatorId: string; username: string; statement: string; evidenceSha256: string }) {
  const [row] = await db
    .update(repairRequests)
    .set({
      status: "queued",
      statusDetail: "Approved. Waiting for the worker to create the Devin session.",
      approvedBy: approval.operatorId,
      approvedByUsername: approval.username,
      approvedAt: new Date(),
      approvalStatement: approval.statement,
      updatedAt: new Date(),
    })
    .where(and(eq(repairRequests.id, repairId), eq(repairRequests.status, "awaiting_approval"), eq(repairRequests.evidenceSha256, approval.evidenceSha256)))
    .returning();
  return row ?? null;
}

/** Cancels a request before any Devin session exists. */
export async function cancelRepair(db: Database, repairId: string) {
  const [row] = await db
    .update(repairRequests)
    .set({ status: "cancelled", cancelledAt: new Date(), statusDetail: "Cancelled by an operator before a Devin session was created.", updatedAt: new Date() })
    .where(and(eq(repairRequests.id, repairId), inArray(repairRequests.status, ["awaiting_approval", "queued"])))
    .returning();
  return row ?? null;
}

/** The worker claims an approved request before calling Devin; only one claimant can win. */
export async function claimRepairSubmission(db: Database, repairId: string, workerId: string) {
  const [row] = await db
    .update(repairRequests)
    .set({ status: "submitting", workerId, submitStartedAt: new Date(), statusDetail: "Creating the Devin session.", updatedAt: new Date() })
    .where(and(eq(repairRequests.id, repairId), eq(repairRequests.status, "queued")))
    .returning();
  return row ?? null;
}

export async function setRepairStatus(db: Database, repairId: string, from: RepairStatus[], to: RepairStatus, detail: string | null, extra: Partial<typeof repairRequests.$inferInsert> = {}) {
  const [row] = await db
    .update(repairRequests)
    .set({ ...extra, status: to, statusDetail: detail, updatedAt: new Date() })
    .where(and(eq(repairRequests.id, repairId), inArray(repairRequests.status, from)))
    .returning();
  return row ?? null;
}

/** Submissions whose worker stopped mid-request. They are recovered by tag lookup, never resubmitted blindly. */
export async function staleSubmissions(db: Database, olderThanMs: number) {
  return db
    .select()
    .from(repairRequests)
    .where(and(eq(repairRequests.status, "submitting"), lt(repairRequests.submitStartedAt, new Date(Date.now() - olderThanMs))));
}

export async function queuedRepairs(db: Database, limit = 5) {
  return db.select().from(repairRequests).where(eq(repairRequests.status, "queued")).orderBy(asc(repairRequests.approvedAt)).limit(limit);
}

/** Active sessions due for a status poll. */
export async function repairsDueForSync(db: Database, intervalMs: number, limit = 10) {
  const cutoff = new Date(Date.now() - intervalMs);
  return db
    .select()
    .from(repairRequests)
    .where(and(inArray(repairRequests.status, [...REPAIR_SYNC_STATUSES]), or(isNull(repairRequests.lastSyncedAt), lt(repairRequests.lastSyncedAt, cutoff))))
    .orderBy(sql`${repairRequests.lastSyncedAt} asc nulls first`)
    .limit(limit);
}

/** Lets an operator ask for an immediate poll (sets the last sync into the past). */
export async function requestRepairSync(db: Database, repairId: string) {
  await db.update(repairRequests).set({ lastSyncedAt: null }).where(eq(repairRequests.id, repairId));
}

/**
 * Queues an independent verification of the pull request's current head
 * commit. The partial unique index allows one active run per repair.
 */
export async function queueVerification(db: Database, repairId: string, operatorId: string) {
  return db.transaction(async (tx) => {
    const [repair] = await tx.select().from(repairRequests).where(eq(repairRequests.id, repairId)).for("update");
    if (!repair) return { ok: false as const, error: "That repair request does not exist." };
    if (!(REPAIR_VERIFIABLE_STATUSES as readonly string[]).includes(repair.status)) {
      return { ok: false as const, error: "Verification needs a validated pull request, and no verification may be running." };
    }
    if (!repair.prHeadSha || !repair.prNumber) return { ok: false as const, error: "No validated pull request head commit is recorded yet." };
    if (!repair.baseSha) return { ok: false as const, error: "The original revision is not recorded for this repair." };
    const [run] = await tx
      .insert(verificationRuns)
      .values({
        repairId,
        requestedBy: operatorId,
        originalSha: repair.baseSha,
        candidateSha: repair.prHeadSha,
        prNumber: repair.prNumber,
        regressionTestSha256: repair.regressionTestSha256,
      })
      .onConflictDoNothing()
      .returning();
    if (!run) return { ok: false as const, error: "A verification is already queued or running for this repair." };
    await tx
      .update(repairRequests)
      .set({ status: "verifying", statusDetail: `Verifying commit ${repair.prHeadSha.slice(0, 12)}.`, latestVerificationId: run.id, updatedAt: new Date() })
      .where(eq(repairRequests.id, repairId));
    return { ok: true as const, runId: run.id, candidateSha: repair.prHeadSha };
  });
}

export async function claimNextVerification(db: Database, workerId: string) {
  const [next] = await db.select({ id: verificationRuns.id }).from(verificationRuns).where(eq(verificationRuns.status, "queued")).orderBy(asc(verificationRuns.createdAt)).limit(1);
  if (!next) return null;
  const [row] = await db
    .update(verificationRuns)
    .set({ status: "running", workerId, startedAt: new Date(), heartbeatAt: new Date(), phase: "Starting" })
    .where(and(eq(verificationRuns.id, next.id), eq(verificationRuns.status, "queued")))
    .returning();
  return row ?? null;
}

/** Returns false when the run is no longer owned by this worker (for example, marked interrupted). */
export async function heartbeatVerification(db: Database, runId: string, workerId: string, phase?: string): Promise<boolean> {
  const [row] = await db
    .update(verificationRuns)
    .set({ heartbeatAt: new Date(), ...(phase ? { phase } : {}) })
    .where(and(eq(verificationRuns.id, runId), eq(verificationRuns.status, "running"), eq(verificationRuns.workerId, workerId)))
    .returning({ id: verificationRuns.id });
  return Boolean(row);
}

/** Records the verdict on the run and mirrors it on the repair, tied to the exact commit tested. */
export async function finishVerification(
  db: Database,
  runId: string,
  workerId: string,
  result: { verdict: VerificationVerdict; rationale: string[]; builds: Record<string, unknown>; errorMessage?: string | null },
) {
  return db.transaction(async (tx) => {
    const finishedAt = new Date();
    const [run] = await tx
      .update(verificationRuns)
      .set({
        status: result.errorMessage ? "failed" : "completed",
        verdict: result.verdict,
        rationale: result.rationale,
        builds: result.builds,
        errorMessage: result.errorMessage ?? null,
        finishedAt,
        phase: null,
        durationMs: sql`greatest(0, (extract(epoch from (${finishedAt.toISOString()}::timestamptz - coalesce(${verificationRuns.startedAt}, ${verificationRuns.createdAt}))) * 1000)::int)`,
      })
      .where(and(eq(verificationRuns.id, runId), eq(verificationRuns.status, "running"), eq(verificationRuns.workerId, workerId)))
      .returning();
    if (!run) return null;
    await tx
      .update(repairRequests)
      .set({ status: result.verdict, statusDetail: null, verdict: result.verdict, verdictRationale: result.rationale, verifiedSha: run.candidateSha, verdictAt: finishedAt, updatedAt: finishedAt })
      .where(and(eq(repairRequests.id, run.repairId), eq(repairRequests.status, "verifying"), eq(repairRequests.latestVerificationId, run.id)));
    return run;
  });
}

/** Closes verifications whose worker stopped reporting. The repair records a blocked verdict with the reason. */
export async function failStaleVerifications(db: Database, staleAfterMs: number) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const message = "The worker stopped reporting during verification (crash or restart). Recorded checks are kept; no verdict was reached.";
  const rows = await db
    .update(verificationRuns)
    .set({ status: "interrupted", verdict: "verification_blocked", rationale: [message], errorMessage: message, finishedAt: new Date(), phase: null })
    .where(and(eq(verificationRuns.status, "running"), or(lt(verificationRuns.heartbeatAt, cutoff), isNull(verificationRuns.heartbeatAt))))
    .returning();
  for (const run of rows) {
    await db
      .update(repairRequests)
      .set({ status: "verification_blocked", verdict: "verification_blocked", verdictRationale: [message], verifiedSha: run.candidateSha, verdictAt: new Date(), updatedAt: new Date() })
      .where(and(eq(repairRequests.id, run.repairId), eq(repairRequests.status, "verifying"), eq(repairRequests.latestVerificationId, run.id)));
    await recordRepairEvent(db, run.repairId, { source: "verification", kind: "verification_interrupted", message, detail: { runId: run.id } });
  }
  return rows;
}

export async function latestRepairForExperiment(db: Database, experimentId: string) {
  const [row] = await db.select().from(repairRequests).where(eq(repairRequests.experimentId, experimentId)).orderBy(desc(repairRequests.createdAt)).limit(1);
  return row ?? null;
}

export async function repositoryForProject(db: Database, projectId: string) {
  const [row] = await db.select().from(sourceRepositories).where(eq(sourceRepositories.projectId, projectId));
  return row ?? null;
}
