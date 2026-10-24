import { eq } from "drizzle-orm";
import { z } from "zod";
import { failQueuedScan, projects, scans, type Database } from "@faultline/db";
import { checkScanTarget, scenarioConfigSchema, type AllowlistEntry } from "@faultline/shared";
import type { ServiceResult } from "./projects";

export const scanInputSchema = z.object({
  projectId: z.uuid("Unknown project."),
  targetUrl: z.string().trim().min(1, "Enter the page URL to scan.").max(2048),
  scenario: scenarioConfigSchema,
});

export interface ScanServiceDeps {
  db: Database;
  allowlist: AllowlistEntry[];
  enqueue: (scanId: string) => Promise<string>;
}

/**
 * Creates a persisted scan record and enqueues a real job.
 * Authorization: caller must be a signed-in operator; the URL must belong to
 * the project's origin, and that origin must be on the server allowlist.
 */
export async function createScan(
  deps: ScanServiceDeps,
  operator: { id: string } | null,
  input: unknown,
): Promise<ServiceResult<{ scanId: string }>> {
  if (!operator) return { ok: false, error: "Sign in to launch scans." };
  const parsed = scanInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const { projectId, targetUrl, scenario } = parsed.data;
  const [project] = await deps.db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { ok: false, error: "That project does not exist." };

  const check = checkScanTarget(targetUrl, project.origin, deps.allowlist);
  if (!check.ok) return { ok: false, error: check.message, fieldErrors: { targetUrl: check.message } };

  const [scan] = await deps.db
    .insert(scans)
    .values({
      projectId,
      targetUrl: check.target.url,
      scenarioKind: scenario.kind,
      scenarioConfig: scenario,
      createdBy: operator.id,
    })
    .returning({ id: scans.id });
  const scanId = scan!.id;
  try {
    const jobId = await deps.enqueue(scanId);
    await deps.db.update(scans).set({ jobId }).where(eq(scans.id, scanId));
  } catch (error) {
    const message = `The scan could not be queued: ${error instanceof Error ? error.message : String(error)}`;
    await failQueuedScan(deps.db, scanId, "enqueue_failed", message);
    return { ok: false, error: message };
  }
  return { ok: true, scanId };
}

/** Parses the new-scan form into the service input shape. */
export function scanInputFromForm(form: FormData) {
  const kind = String(form.get("scenarioKind") ?? "");
  const viewport = String(form.get("viewport") ?? "desktop");
  const scenario =
    kind === "resource-block"
      ? {
          kind,
          resourceTypes: form.getAll("resourceTypes").map(String),
          scope: String(form.get("scope") ?? "all"),
          abortErrorCode: String(form.get("abortErrorCode") ?? "failed"),
          viewport,
        }
      : { kind, viewport };
  return {
    projectId: String(form.get("projectId") ?? ""),
    targetUrl: String(form.get("targetUrl") ?? ""),
    scenario,
  };
}
