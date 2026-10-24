"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestScanCancellation, scans } from "@faultline/db";
import { requireOperator } from "@/lib/auth/dal";
import { isUuid } from "@/lib/data/queries";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { cancelScanJob, enqueueScan } from "@/lib/queue";
import { createAnalysis } from "@/lib/services/analyses";
import { createScan, scanInputFromForm } from "@/lib/services/scans";

export interface ScanFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function deps() {
  return { db: getDb(), allowlist: getEnv().FAULTLINE_SCAN_ALLOWLIST, enqueue: enqueueScan };
}

export async function launchScanAction(_prev: ScanFormState, form: FormData): Promise<ScanFormState> {
  const operator = await requireOperator();
  const result = await createScan(deps(), operator, scanInputFromForm(form));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/scans/${result.scanId}`);
}

/** Queues a new scan with the same target and scenario as an existing one. */
export async function rerunScanAction(form: FormData): Promise<void> {
  const operator = await requireOperator();
  const scanId = String(form.get("scanId") ?? "");
  if (!isUuid(scanId)) return;
  const [previous] = await getDb().select().from(scans).where(eq(scans.id, scanId));
  if (!previous) return;
  if (previous.scenarioConfig.kind === "blast-radius") {
    // Re-run the same journey version with the same configuration.
    const env = getEnv();
    const config = previous.journeySnapshot ? { ...previous.scenarioConfig, journeyId: previous.journeySnapshot.id } : previous.scenarioConfig;
    const result = await createAnalysis(
      { db: getDb(), allowlist: env.FAULTLINE_SCAN_ALLOWLIST, enqueue: enqueueScan, maxActive: env.FAULTLINE_MAX_ACTIVE_ANALYSES },
      operator,
      { projectId: previous.projectId, config },
    );
    if (!result.ok) redirect(`/scans/${scanId}/blast-radius?rerunError=${encodeURIComponent(result.error.slice(0, 300))}`);
    redirect(`/scans/${result.scanId}/blast-radius`);
  }
  const result = await createScan(deps(), operator, {
    projectId: previous.projectId,
    targetUrl: previous.targetUrl,
    scenario: previous.scenarioConfig,
  });
  if (!result.ok) redirect(`/scans/${scanId}?rerunError=${encodeURIComponent(result.error.slice(0, 300))}`);
  redirect(`/scans/${result.scanId}`);
}

export async function cancelScanAction(form: FormData): Promise<void> {
  await requireOperator();
  const scanId = String(form.get("scanId") ?? "");
  if (!isUuid(scanId)) return;
  const db = getDb();
  const outcome = await requestScanCancellation(db, scanId);
  if (outcome === "cancelled") {
    const [row] = await db.select({ jobId: scans.jobId }).from(scans).where(eq(scans.id, scanId));
    if (row?.jobId) await cancelScanJob(row.jobId);
  }
  revalidatePath(`/scans/${scanId}`);
}
