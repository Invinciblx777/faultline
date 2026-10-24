import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  artifacts,
  dependencies,
  executionEvents,
  experiments,
  journeys,
  networkRequests,
  projects,
  regressionTests,
  scanExecutions,
  scans,
  stepResults,
} from "@faultline/db";
import { EXPERIMENT_KINDS, VERDICTS, type ExperimentKind, type Verdict } from "@faultline/shared";
import { getDb } from "../db";
import { isUuid } from "./queries";

/** Latest version of every journey lineage in a project. */
export async function listJourneys(projectId: string) {
  if (!isUuid(projectId)) return [];
  const rows = await getDb()
    .select({
      id: journeys.id,
      lineageId: journeys.lineageId,
      version: journeys.version,
      name: journeys.name,
      definition: journeys.definition,
      createdAt: journeys.createdAt,
    })
    .from(journeys)
    .where(eq(journeys.projectId, projectId))
    .orderBy(asc(journeys.lineageId), desc(journeys.version));
  const latest = new Map<string, (typeof rows)[number] & { versionCount: number }>();
  for (const row of rows) {
    const seen = latest.get(row.lineageId);
    if (seen) seen.versionCount += 1;
    else latest.set(row.lineageId, { ...row, versionCount: 1 });
  }
  return [...latest.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type JourneyListItem = Awaited<ReturnType<typeof listJourneys>>[number];

/** A journey version with its project, every version in its lineage, and the analyses that ran any of them. */
export async function getJourney(id: string) {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [row] = await db.select({ journey: journeys, project: projects }).from(journeys).innerJoin(projects, eq(projects.id, journeys.projectId)).where(eq(journeys.id, id));
  if (!row) return null;
  const versions = await db
    .select({ id: journeys.id, version: journeys.version, createdAt: journeys.createdAt, name: journeys.name })
    .from(journeys)
    .where(eq(journeys.lineageId, row.journey.lineageId))
    .orderBy(desc(journeys.version));
  const analyses = await db
    .select({ id: scans.id, status: scans.status, createdAt: scans.createdAt, journeyId: scans.journeyId, version: sql<number | null>`(${scans.journeySnapshot}->>'version')::int` })
    .from(scans)
    .where(and(eq(scans.projectId, row.project.id), sql`${scans.journeySnapshot}->>'lineageId' = ${row.journey.lineageId}`))
    .orderBy(desc(scans.createdAt))
    .limit(20);
  return { ...row, versions, latestVersion: versions[0]?.version ?? row.journey.version, analyses };
}

export type JourneyDetail = NonNullable<Awaited<ReturnType<typeof getJourney>>>;

/** Everything the Blast Radius map needs for one analysis. */
export async function getAnalysis(scanId: string) {
  if (!isUuid(scanId)) return null;
  const db = getDb();
  const [row] = await db.select({ scan: scans, project: projects }).from(scans).innerJoin(projects, eq(projects.id, scans.projectId)).where(eq(scans.id, scanId));
  if (!row || row.scan.scenarioKind !== "blast-radius") return null;
  const [executions, deps, exps, tests] = await Promise.all([
    db
      .select({
        id: scanExecutions.id,
        role: scanExecutions.role,
        ordinal: scanExecutions.ordinal,
        attempt: scanExecutions.attempt,
        experimentId: scanExecutions.experimentId,
        status: scanExecutions.status,
        outcome: scanExecutions.outcome,
        durationMs: scanExecutions.durationMs,
        failureMessage: scanExecutions.failureMessage,
        summary: scanExecutions.summary,
        viewport: scanExecutions.viewport,
        startedAt: scanExecutions.startedAt,
      })
      .from(scanExecutions)
      .where(eq(scanExecutions.scanId, scanId))
      .orderBy(asc(scanExecutions.createdAt)),
    db.select().from(dependencies).where(eq(dependencies.scanId, scanId)).orderBy(asc(dependencies.key)),
    db.select().from(experiments).where(eq(experiments.scanId, scanId)).orderBy(asc(experiments.ordinal)),
    db
      .select({ id: regressionTests.id, experimentId: regressionTests.experimentId, filename: regressionTests.filename, validationStatus: regressionTests.validationStatus })
      .from(regressionTests)
      .where(eq(regressionTests.scanId, scanId)),
  ]);
  const normalIds = executions.filter((e) => e.role === "baseline" || e.role === "calibration").map((e) => e.id);
  const steps = normalIds.length ? await db.select().from(stepResults).where(inArray(stepResults.executionId, normalIds)).orderBy(asc(stepResults.stepIndex)) : [];
  return { ...row, executions, dependencies: deps, experiments: exps, regressionTests: tests, normalSteps: steps };
}

export type AnalysisDetail = NonNullable<Awaited<ReturnType<typeof getAnalysis>>>;

/** Live progress for an analysis: scan state plus experiment states, all from stored rows. */
export async function getAnalysisStatus(scanId: string) {
  if (!isUuid(scanId)) return null;
  const db = getDb();
  const [scan] = await db
    .select({ id: scans.id, status: scans.status, phase: scans.phase, cancelRequestedAt: scans.cancelRequestedAt, startedAt: scans.startedAt, finishedAt: scans.finishedAt })
    .from(scans)
    .where(eq(scans.id, scanId));
  if (!scan) return null;
  const [executions, exps] = await Promise.all([
    db
      .select({ role: scanExecutions.role, status: scanExecutions.status, attempt: scanExecutions.attempt, experimentId: scanExecutions.experimentId })
      .from(scanExecutions)
      .where(eq(scanExecutions.scanId, scanId)),
    db
      .select({ id: experiments.id, ordinal: experiments.ordinal, kind: experiments.kind, dependencyLabel: experiments.dependencyLabel, status: experiments.status, verdict: experiments.verdict })
      .from(experiments)
      .where(eq(experiments.scanId, scanId))
      .orderBy(asc(experiments.ordinal)),
  ]);
  return { ...scan, executions, experiments: exps };
}

export type AnalysisStatus = NonNullable<Awaited<ReturnType<typeof getAnalysisStatus>>>;

async function executionEvidence(executionIds: string[]) {
  const db = getDb();
  if (!executionIds.length) return { events: [], requests: [], steps: [], files: [] };
  const [events, requests, steps, files] = await Promise.all([
    db.select().from(executionEvents).where(inArray(executionEvents.executionId, executionIds)).orderBy(asc(executionEvents.seq)),
    db.select().from(networkRequests).where(inArray(networkRequests.executionId, executionIds)).orderBy(asc(networkRequests.requestId)),
    db.select().from(stepResults).where(inArray(stepResults.executionId, executionIds)).orderBy(asc(stepResults.phase), asc(stepResults.stepIndex)),
    db.select().from(artifacts).where(inArray(artifacts.executionId, executionIds)),
  ]);
  return { events, requests, steps, files };
}

/** One experiment with the baseline it is compared against and every attempt's evidence. */
export async function getExperimentDetail(experimentId: string) {
  if (!isUuid(experimentId)) return null;
  const db = getDb();
  const [row] = await db
    .select({ experiment: experiments, scan: scans, project: projects })
    .from(experiments)
    .innerJoin(scans, eq(scans.id, experiments.scanId))
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .where(eq(experiments.id, experimentId));
  if (!row) return null;
  const executions = await db
    .select()
    .from(scanExecutions)
    .where(eq(scanExecutions.scanId, row.scan.id))
    .orderBy(asc(scanExecutions.createdAt));
  const baseline = executions.find((e) => e.role === "baseline") ?? null;
  const calibration = executions.find((e) => e.role === "calibration") ?? null;
  const attempts = executions.filter((e) => e.experimentId === experimentId).sort((a, b) => a.attempt - b.attempt);
  const ids = [baseline?.id, ...attempts.map((a) => a.id)].filter((id): id is string => Boolean(id));
  const evidence = await executionEvidence(ids);
  const [dependency] = row.experiment.dependencyId ? await db.select().from(dependencies).where(eq(dependencies.id, row.experiment.dependencyId)) : [];
  const [test] = await db.select().from(regressionTests).where(eq(regressionTests.experimentId, experimentId));
  const withEvidence = <T extends { id: string }>(execution: T) => ({
    ...execution,
    events: evidence.events.filter((e) => e.executionId === execution.id),
    requests: evidence.requests.filter((r) => r.executionId === execution.id),
    steps: evidence.steps.filter((s) => s.executionId === execution.id),
    screenshot: evidence.files.find((f) => f.executionId === execution.id && f.kind === "screenshot") ?? null,
    diff: evidence.files.find((f) => f.executionId === execution.id && f.kind === "diff") ?? null,
    stepScreenshots: evidence.files.filter((f) => f.executionId === execution.id && f.kind === "step-screenshot"),
  });
  return {
    ...row,
    baseline: baseline ? withEvidence(baseline) : null,
    calibration: calibration ? { id: calibration.id, status: calibration.status, durationMs: calibration.durationMs } : null,
    attempts: attempts.map(withEvidence),
    dependency: dependency ?? null,
    regressionTest: test ? { ...test, validationOutput: undefined } : null,
  };
}

export type ExperimentDetail = NonNullable<Awaited<ReturnType<typeof getExperimentDetail>>>;

export interface ExperimentFilters {
  verdict?: Verdict;
  kind?: ExperimentKind;
  projectId?: string;
}

export function normalizeExperimentFilters(params: Record<string, string | string[] | undefined>): ExperimentFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const verdict = one(params.verdict);
  const kind = one(params.kind);
  return {
    verdict: verdict && (VERDICTS as readonly string[]).includes(verdict) ? (verdict as Verdict) : undefined,
    kind: kind && (EXPERIMENT_KINDS as readonly string[]).includes(kind) ? (kind as ExperimentKind) : undefined,
  };
}

/** Experiment history across analyses, newest first. */
export async function listExperiments(filters: ExperimentFilters = {}, limit = 200) {
  const where: SQL[] = [];
  if (filters.verdict) where.push(eq(experiments.verdict, filters.verdict));
  if (filters.kind) where.push(eq(experiments.kind, filters.kind));
  if (filters.projectId) where.push(eq(scans.projectId, filters.projectId));
  return getDb()
    .select({
      id: experiments.id,
      scanId: experiments.scanId,
      kind: experiments.kind,
      fault: experiments.fault,
      dependencyLabel: experiments.dependencyLabel,
      status: experiments.status,
      verdict: experiments.verdict,
      reproducibility: experiments.reproducibility,
      affectedSteps: experiments.affectedSteps,
      createdAt: experiments.createdAt,
      projectId: projects.id,
      projectName: projects.name,
      journeyName: sql<string | null>`${scans.journeySnapshot}->'definition'->>'name'`,
      journeyVersion: sql<number | null>`(${scans.journeySnapshot}->>'version')::int`,
      testStatus: regressionTests.validationStatus,
    })
    .from(experiments)
    .innerJoin(scans, eq(scans.id, experiments.scanId))
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .leftJoin(regressionTests, eq(regressionTests.experimentId, experiments.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(experiments.createdAt), asc(experiments.ordinal))
    .limit(limit);
}

export type ExperimentListItem = Awaited<ReturnType<typeof listExperiments>>[number];

/** Verdict counts per analysis, for scan lists. */
export async function verdictCounts(scanIds: string[]) {
  if (!scanIds.length) return new Map<string, Partial<Record<Verdict, number>>>();
  const rows = await getDb()
    .select({ scanId: experiments.scanId, verdict: experiments.verdict, n: sql<number>`count(*)::int` })
    .from(experiments)
    .where(inArray(experiments.scanId, scanIds))
    .groupBy(experiments.scanId, experiments.verdict);
  const map = new Map<string, Partial<Record<Verdict, number>>>();
  for (const row of rows) {
    if (!row.verdict) continue;
    const entry = map.get(row.scanId) ?? {};
    entry[row.verdict] = row.n;
    map.set(row.scanId, entry);
  }
  return map;
}

export async function getRegressionTest(experimentId: string) {
  if (!isUuid(experimentId)) return null;
  const [row] = await getDb().select().from(regressionTests).where(eq(regressionTests.experimentId, experimentId));
  return row ?? null;
}
