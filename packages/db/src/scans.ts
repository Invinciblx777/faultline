import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { ScanEnvironment, ScanStatus } from "@faultline/shared";
import type { Database } from "./client";
import { scans } from "./schema";

/**
 * Scan lifecycle transitions. Each transition is a single conditional UPDATE,
 * so concurrent actors (web cancel, worker, stale sweeper) cannot both win.
 */

export async function claimScan(db: Database, scanId: string, workerId: string) {
  const [row] = await db
    .update(scans)
    .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date(), workerId, phase: "Starting browser" })
    .where(and(eq(scans.id, scanId), eq(scans.status, "queued")))
    .returning();
  return row ?? null;
}

/** Records liveness and progress. Returns whether cancellation was requested. */
export async function heartbeatScan(db: Database, scanId: string, phase?: string): Promise<{ cancelRequested: boolean; running: boolean }> {
  const [row] = await db
    .update(scans)
    .set({ heartbeatAt: new Date(), ...(phase ? { phase } : {}) })
    .where(and(eq(scans.id, scanId), eq(scans.status, "running")))
    .returning({ cancelRequestedAt: scans.cancelRequestedAt });
  return { cancelRequested: Boolean(row?.cancelRequestedAt), running: Boolean(row) };
}

export async function finishScan(
  db: Database,
  scanId: string,
  result: {
    status: Extract<ScanStatus, "completed" | "failed" | "cancelled">;
    errorCode?: string | null;
    errorMessage?: string | null;
    environment?: ScanEnvironment | null;
  },
) {
  const finishedAt = new Date();
  const [row] = await db
    .update(scans)
    .set({
      status: result.status,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      ...(result.environment ? { environment: result.environment } : {}),
      finishedAt,
      phase: null,
      durationMs: sql`greatest(0, (extract(epoch from (${finishedAt.toISOString()}::timestamptz - coalesce(${scans.startedAt}, ${scans.createdAt}))) * 1000)::int)`,
    })
    .where(and(eq(scans.id, scanId), eq(scans.status, "running")))
    .returning();
  return row ?? null;
}

/** Marks a scan failed before it started (e.g. it could not be enqueued, or a pre-flight check refused it). */
export async function failQueuedScan(db: Database, scanId: string, errorCode: string, errorMessage: string) {
  const [row] = await db
    .update(scans)
    .set({ status: "failed", errorCode, errorMessage, finishedAt: new Date(), phase: null })
    .where(and(eq(scans.id, scanId), eq(scans.status, "queued")))
    .returning();
  return row ?? null;
}

/**
 * Cancels a queued scan immediately, or flags a running scan so its worker stops.
 * Returns the resulting state.
 */
export async function requestScanCancellation(db: Database, scanId: string): Promise<"cancelled" | "cancel_requested" | "not_cancellable"> {
  const [queued] = await db
    .update(scans)
    .set({ status: "cancelled", finishedAt: new Date(), cancelRequestedAt: new Date(), phase: null, errorCode: "cancelled", errorMessage: "Cancelled by operator before it started." })
    .where(and(eq(scans.id, scanId), eq(scans.status, "queued")))
    .returning({ id: scans.id });
  if (queued) return "cancelled";
  const [running] = await db
    .update(scans)
    .set({ cancelRequestedAt: new Date() })
    .where(and(eq(scans.id, scanId), eq(scans.status, "running"), isNull(scans.cancelRequestedAt)))
    .returning({ id: scans.id });
  return running ? "cancel_requested" : "not_cancellable";
}

/**
 * Fails running scans whose worker stopped reporting (crash, OOM, host restart).
 * Without this a crashed worker would leave scans "running" forever.
 */
export async function failStaleScans(db: Database, staleAfterMs: number) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  return db
    .update(scans)
    .set({
      status: "failed",
      errorCode: "worker_interrupted",
      errorMessage: "The worker stopped reporting progress before the scan finished (crash or restart). Evidence recorded before the interruption is kept.",
      finishedAt: new Date(),
      phase: null,
    })
    .where(and(eq(scans.status, "running"), or(lt(scans.heartbeatAt, cutoff), isNull(scans.heartbeatAt))))
    .returning({ id: scans.id });
}

/** Fails scans a given worker was running when it restarted. */
export async function failScansOwnedBy(db: Database, workerIds: string[]) {
  if (workerIds.length === 0) return [];
  return db
    .update(scans)
    .set({
      status: "failed",
      errorCode: "worker_interrupted",
      errorMessage: "The worker restarted while this scan was running.",
      finishedAt: new Date(),
      phase: null,
    })
    .where(and(eq(scans.status, "running"), inArray(scans.workerId, workerIds)))
    .returning({ id: scans.id });
}
