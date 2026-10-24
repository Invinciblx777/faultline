import "server-only";
import type { PgBoss } from "pg-boss";
import { createBoss, ensureScanQueue, SCAN_QUEUE, type ScanJobData } from "@faultline/db";
import { getEnv } from "./env";

const globalForQueue = globalThis as unknown as { faultlineBoss?: Promise<PgBoss> };

/** A send-only pg-boss producer; maintenance runs in the worker. */
function getBoss(): Promise<PgBoss> {
  globalForQueue.faultlineBoss ??= (async () => {
    const boss = createBoss(getEnv().DATABASE_URL, "faultline-web", "producer");
    boss.on("error", (error) => console.error("[queue] pg-boss error:", error.message));
    await boss.start();
    await ensureScanQueue(boss);
    return boss;
  })().catch((error) => {
    globalForQueue.faultlineBoss = undefined;
    throw error;
  });
  return globalForQueue.faultlineBoss;
}

export async function enqueueScan(scanId: string, options: { expireInSeconds?: number } = {}): Promise<string> {
  const boss = await getBoss();
  const jobId = await boss.send(SCAN_QUEUE, { scanId } satisfies ScanJobData, options);
  if (!jobId) throw new Error("The job queue did not accept the scan.");
  return jobId;
}

export async function cancelScanJob(jobId: string): Promise<void> {
  const boss = await getBoss();
  await boss.cancel(SCAN_QUEUE, jobId).catch(() => undefined);
}
