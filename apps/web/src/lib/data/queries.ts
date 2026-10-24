import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  artifacts,
  executionEvents,
  projects,
  scanExecutions,
  scans,
  WORKER_STALE_AFTER_MS,
  workerInstances,
} from "@faultline/db";
import { SCAN_STATUSES, SCENARIO_KINDS, type ScanStatus, type ScenarioKind } from "@faultline/shared";
import { getDb } from "../db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export async function listProjects() {
  const db = getDb();
  const lastScan = db
    .select({
      projectId: scans.projectId,
      scanCount: sql<number>`count(*)::int`.as("scan_count"),
      lastScanAt: sql<Date | null>`max(${scans.createdAt})`.as("last_scan_at"),
    })
    .from(scans)
    .groupBy(scans.projectId)
    .as("last_scan");
  return db
    .select({
      id: projects.id,
      name: projects.name,
      origin: projects.origin,
      description: projects.description,
      createdAt: projects.createdAt,
      scanCount: sql<number>`coalesce(${lastScan.scanCount}, 0)`,
      lastScanAt: lastScan.lastScanAt,
    })
    .from(projects)
    .leftJoin(lastScan, eq(lastScan.projectId, projects.id))
    .orderBy(desc(projects.createdAt));
}

export async function getProject(id: string) {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}

export interface ScanListFilters {
  projectId?: string;
  status?: string;
  scenario?: string;
  q?: string;
  limit?: number;
}

export function normalizeFilters(params: Record<string, string | string[] | undefined>): ScanListFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const status = one(params.status);
  const scenario = one(params.scenario);
  return {
    status: status && (SCAN_STATUSES as readonly string[]).includes(status) ? status : undefined,
    scenario: scenario && (SCENARIO_KINDS as readonly string[]).includes(scenario) ? scenario : undefined,
    q: one(params.q)?.slice(0, 200),
  };
}

export async function listScans(filters: ScanListFilters = {}) {
  const db = getDb();
  const where: SQL[] = [];
  if (filters.projectId) where.push(eq(scans.projectId, filters.projectId));
  if (filters.status) where.push(eq(scans.status, filters.status as ScanStatus));
  if (filters.scenario) where.push(eq(scans.scenarioKind, filters.scenario as ScenarioKind));
  if (filters.q) where.push(ilike(scans.targetUrl, `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  const rows = await db
    .select({
      id: scans.id,
      projectId: scans.projectId,
      projectName: projects.name,
      targetUrl: scans.targetUrl,
      scenarioKind: scans.scenarioKind,
      scenarioConfig: scans.scenarioConfig,
      status: scans.status,
      phase: scans.phase,
      errorCode: scans.errorCode,
      createdAt: scans.createdAt,
      startedAt: scans.startedAt,
      finishedAt: scans.finishedAt,
      durationMs: scans.durationMs,
    })
    .from(scans)
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(scans.createdAt))
    .limit(filters.limit ?? 100);
  const outcomes = rows.length
    ? await db
        .select({ scanId: scanExecutions.scanId, role: scanExecutions.role, status: scanExecutions.status, outcome: scanExecutions.outcome })
        .from(scanExecutions)
        .where(inArray(scanExecutions.scanId, rows.map((r) => r.id)))
    : [];
  return rows.map((row) => ({
    ...row,
    executions: outcomes.filter((o) => o.scanId === row.id),
  }));
}

export type ScanListItem = Awaited<ReturnType<typeof listScans>>[number];

export async function getScanDetail(id: string) {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({ scan: scans, project: projects })
    .from(scans)
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .where(eq(scans.id, id));
  if (!row) return null;
  const executions = await db.select().from(scanExecutions).where(eq(scanExecutions.scanId, id)).orderBy(asc(scanExecutions.createdAt));
  const executionIds = executions.map((e) => e.id);
  const [events, files] = executionIds.length
    ? await Promise.all([
        db.select().from(executionEvents).where(inArray(executionEvents.executionId, executionIds)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.seq)),
        db.select().from(artifacts).where(eq(artifacts.scanId, id)),
      ])
    : [[], []];
  return {
    scan: row.scan,
    project: row.project,
    executions: executions.map((execution) => ({
      ...execution,
      events: events.filter((e) => e.executionId === execution.id),
      screenshot: files.find((a) => a.executionId === execution.id && a.kind === "screenshot") ?? null,
    })),
  };
}

export type ScanDetail = NonNullable<Awaited<ReturnType<typeof getScanDetail>>>;

export async function getScanStatus(id: string) {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [scan] = await db
    .select({ id: scans.id, status: scans.status, phase: scans.phase, cancelRequestedAt: scans.cancelRequestedAt, startedAt: scans.startedAt, finishedAt: scans.finishedAt, durationMs: scans.durationMs, errorCode: scans.errorCode, errorMessage: scans.errorMessage })
    .from(scans)
    .where(eq(scans.id, id));
  if (!scan) return null;
  const executions = await db
    .select({ role: scanExecutions.role, status: scanExecutions.status, outcome: scanExecutions.outcome, durationMs: scanExecutions.durationMs })
    .from(scanExecutions)
    .where(eq(scanExecutions.scanId, id));
  return { ...scan, executions };
}

export async function getArtifact(id: string) {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select().from(artifacts).where(eq(artifacts.id, id));
  return row ?? null;
}

export async function getWorkerStatus() {
  const cutoff = new Date(Date.now() - WORKER_STALE_AFTER_MS);
  const online = await getDb()
    .select()
    .from(workerInstances)
    .where(and(gt(workerInstances.lastHeartbeatAt, cutoff), isNull(workerInstances.stoppedAt)))
    .orderBy(desc(workerInstances.lastHeartbeatAt));
  const [lastSeen] = online.length
    ? [online[0]]
    : await getDb().select().from(workerInstances).orderBy(desc(workerInstances.lastHeartbeatAt)).limit(1);
  return { online, lastSeen: lastSeen ?? null };
}

export async function getQueueCounts() {
  const rows = await getDb()
    .select({ status: scans.status, count: sql<number>`count(*)::int` })
    .from(scans)
    .where(inArray(scans.status, ["queued", "running"]))
    .groupBy(scans.status);
  return {
    queued: rows.find((r) => r.status === "queued")?.count ?? 0,
    running: rows.find((r) => r.status === "running")?.count ?? 0,
  };
}
