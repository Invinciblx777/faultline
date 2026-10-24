import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { artifacts, experiments, projects, regressionTests, repairEvents, repairRequests, scanExecutions, scans, sourceRepositories, verificationChecks, verificationRuns } from "@faultline/db";
import { getDb } from "../db";
import { isUuid } from "./queries";

export async function getProjectRepository(projectId: string) {
  if (!isUuid(projectId)) return null;
  const [row] = await getDb().select().from(sourceRepositories).where(eq(sourceRepositories.projectId, projectId));
  return row ?? null;
}

/** The newest repair request for a finding, if any. */
export async function getRepairForExperiment(experimentId: string) {
  if (!isUuid(experimentId)) return null;
  const [row] = await getDb()
    .select({ id: repairRequests.id, status: repairRequests.status, createdAt: repairRequests.createdAt, prNumber: repairRequests.prNumber, verdict: repairRequests.verdict })
    .from(repairRequests)
    .where(eq(repairRequests.experimentId, experimentId))
    .orderBy(desc(repairRequests.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listRepairs(limit = 100) {
  return getDb()
    .select({
      id: repairRequests.id,
      status: repairRequests.status,
      createdAt: repairRequests.createdAt,
      updatedAt: repairRequests.updatedAt,
      repoOwner: repairRequests.repoOwner,
      repoName: repairRequests.repoName,
      prNumber: repairRequests.prNumber,
      prUrl: repairRequests.prUrl,
      verdict: repairRequests.verdict,
      verifiedSha: repairRequests.verifiedSha,
      devinStatus: repairRequests.devinStatus,
      fault: sql<string>`${repairRequests.evidence}->'finding'->>'fault'`,
      projectName: projects.name,
      projectId: projects.id,
      experimentId: repairRequests.experimentId,
      scanId: repairRequests.scanId,
    })
    .from(repairRequests)
    .innerJoin(projects, eq(projects.id, repairRequests.projectId))
    .orderBy(desc(repairRequests.createdAt))
    .limit(limit);
}

export type RepairListItem = Awaited<ReturnType<typeof listRepairs>>[number];

/** A repair with its audit trail, verification runs, checks, and the original finding's screenshots. */
export async function getRepair(id: string) {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({ repair: repairRequests, project: projects, repository: sourceRepositories, experiment: experiments })
    .from(repairRequests)
    .innerJoin(projects, eq(projects.id, repairRequests.projectId))
    .innerJoin(sourceRepositories, eq(sourceRepositories.id, repairRequests.repositoryId))
    .innerJoin(experiments, eq(experiments.id, repairRequests.experimentId))
    .where(eq(repairRequests.id, id));
  if (!row) return null;
  const [events, runs] = await Promise.all([
    db.select().from(repairEvents).where(eq(repairEvents.repairId, id)).orderBy(asc(repairEvents.occurredAt), asc(repairEvents.id)),
    db.select().from(verificationRuns).where(eq(verificationRuns.repairId, id)).orderBy(desc(verificationRuns.createdAt)),
  ]);
  const checks = runs.length
    ? await db
        .select()
        .from(verificationChecks)
        .where(inArray(verificationChecks.runId, runs.map((r) => r.id)))
        .orderBy(asc(verificationChecks.ordinal))
    : [];
  // Screenshots recorded by the original analysis (baseline and first fault attempt).
  const originalShots = row.repair.evidence.artifacts.length
    ? await db
        .select({ id: artifacts.id, executionId: artifacts.executionId, width: artifacts.width, height: artifacts.height, sha256: artifacts.sha256, role: scanExecutions.role })
        .from(artifacts)
        .innerJoin(scanExecutions, eq(scanExecutions.id, artifacts.executionId))
        .where(inArray(artifacts.id, row.repair.evidence.artifacts.map((a) => a.id)))
    : [];
  // Other findings in this project whose validated regression test can cross-check the same commit.
  const crossCheckFindings = await db
    .select({
      experimentId: experiments.id,
      scanId: experiments.scanId,
      verdict: experiments.verdict,
      fault: experiments.fault,
      dependencyLabel: experiments.dependencyLabel,
      journey: scans.journeySnapshot,
      testFilename: regressionTests.filename,
      testSha256: regressionTests.sha256,
      createdAt: experiments.createdAt,
    })
    .from(experiments)
    .innerJoin(scans, eq(scans.id, experiments.scanId))
    .innerJoin(regressionTests, eq(regressionTests.experimentId, experiments.id))
    .where(and(eq(scans.projectId, row.repair.projectId), ne(experiments.id, row.repair.experimentId), eq(regressionTests.validationStatus, "fails_as_expected")))
    .orderBy(desc(experiments.createdAt))
    .limit(20);
  return { ...row, events, runs: runs.map((run) => ({ ...run, checks: checks.filter((c) => c.runId === run.id) })), originalShots, crossCheckFindings };
}

export type RepairDetail = NonNullable<Awaited<ReturnType<typeof getRepair>>>;

/** Small polling payload: changes whenever anything visible on the repair page changes. */
export async function getRepairStatus(id: string) {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [repair] = await db
    .select({
      status: repairRequests.status,
      statusDetail: repairRequests.statusDetail,
      devinStatus: repairRequests.devinStatus,
      devinStatusDetail: repairRequests.devinStatusDetail,
      lastSyncedAt: repairRequests.lastSyncedAt,
      syncError: repairRequests.syncError,
      prHeadSha: repairRequests.prHeadSha,
      updatedAt: repairRequests.updatedAt,
      latestVerificationId: repairRequests.latestVerificationId,
    })
    .from(repairRequests)
    .where(eq(repairRequests.id, id));
  if (!repair) return null;
  const [{ events }] = (await db.execute(sql`select count(*)::int as events from repair_events where repair_id = ${id}`)).rows as [{ events: number }];
  let verification: { status: string; phase: string | null; checks: number } | null = null;
  if (repair.latestVerificationId) {
    const [run] = await db.select({ status: verificationRuns.status, phase: verificationRuns.phase }).from(verificationRuns).where(eq(verificationRuns.id, repair.latestVerificationId));
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from verification_checks where run_id = ${repair.latestVerificationId} and status <> 'running'`)).rows as [{ n: number }];
    verification = run ? { ...run, checks: n } : null;
  }
  return { ...repair, events, verification };
}

export type RepairLiveStatus = NonNullable<Awaited<ReturnType<typeof getRepairStatus>>>;

export async function getVerificationCheckScreenshot(checkId: string) {
  if (!isUuid(checkId)) return null;
  const [row] = await getDb()
    .select({ key: verificationChecks.screenshotKey, sha256: verificationChecks.screenshotSha256, bytes: verificationChecks.screenshotBytes })
    .from(verificationChecks)
    .where(eq(verificationChecks.id, checkId));
  return row?.key && row.sha256 && row.bytes ? { key: row.key, sha256: row.sha256, bytes: row.bytes } : null;
}
