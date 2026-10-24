import { PgBoss } from "pg-boss";

/** pg-boss queue that carries scan jobs from the web app to workers. */
export const SCAN_QUEUE = "faultline-scan";

/** pg-boss stores its tables in this schema, separate from application tables. */
export const PGBOSS_SCHEMA = "pgboss";

export interface ScanJobData {
  scanId: string;
}

/**
 * Blast Radius analyses run many isolated executions in one job, so their
 * jobs may stay active longer than a page scan before pg-boss expires them.
 * The worker enforces its own analysis budget well inside this window.
 */
export const ANALYSIS_JOB_EXPIRE_SECONDS = 60 * 60;

/** A running scan whose worker has not reported for this long is considered interrupted. */
export const SCAN_STALE_AFTER_MS = 90_000;
/** A worker that has not reported for this long is shown as offline. */
export const WORKER_STALE_AFTER_MS = 45_000;

/**
 * @param role `worker` runs pg-boss maintenance and supervision; `producer`
 * (the web app) only sends and cancels jobs.
 */
export function createBoss(connectionString: string, applicationName: string, role: "worker" | "producer" = "worker"): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: applicationName,
    max: role === "worker" ? 4 : 2,
    ...(role === "producer" ? { supervise: false, schedule: false, registerInstance: false } : {}),
  });
}

/**
 * Creates the scan queue if needed. Scans are not retried automatically: a
 * failed scan is recorded as failed and the operator decides whether to rerun.
 */
export async function ensureScanQueue(boss: PgBoss): Promise<void> {
  const existing = await boss.getQueue(SCAN_QUEUE);
  if (existing) return;
  try {
    await boss.createQueue(SCAN_QUEUE, { retryLimit: 0, expireInSeconds: 15 * 60, deleteAfterSeconds: 7 * 24 * 3600 });
  } catch (error) {
    // Another process may have created it concurrently.
    if (!(await boss.getQueue(SCAN_QUEUE))) throw error;
  }
}
