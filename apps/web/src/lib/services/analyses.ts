import { and, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ANALYSIS_JOB_EXPIRE_SECONDS, failQueuedScan, journeys, projects, scans, type Database } from "@faultline/db";
import {
  blastRadiusConfigSchema,
  checkScanTarget,
  FAULT_KINDS,
  journeyDefinitionSchema,
  resolveJourneyUrl,
  type AllowlistEntry,
} from "@faultline/shared";
import type { ServiceResult } from "./projects";

export const analysisInputSchema = z.object({
  projectId: z.uuid("Unknown project."),
  config: z.unknown(),
});

export interface AnalysisServiceDeps {
  db: Database;
  allowlist: AllowlistEntry[];
  enqueue: (scanId: string, options: { expireInSeconds: number }) => Promise<string>;
  /** Analyses that may be queued or running at once across all projects. */
  maxActive: number;
}

const ACTIVE = ["queued", "running"] as const;

/**
 * Creates a Blast Radius analysis for a saved journey version and enqueues it.
 *
 * Authorization: a signed-in operator, a project whose origin is on the
 * server allowlist, and a journey that belongs to that project. Capacity: one
 * active analysis per project and `maxActive` in total, checked under an
 * advisory lock so concurrent launches cannot both pass.
 */
export async function createAnalysis(
  deps: AnalysisServiceDeps,
  operator: { id: string } | null,
  input: unknown,
): Promise<ServiceResult<{ scanId: string }>> {
  if (!operator) return { ok: false, error: "Sign in to launch analyses." };
  const parsed = analysisInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const config = blastRadiusConfigSchema.safeParse(parsed.data.config);
  if (!config.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of config.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: config.error.issues[0]?.message ?? "Check the highlighted fields.", fieldErrors };
  }

  const [project] = await deps.db.select().from(projects).where(eq(projects.id, parsed.data.projectId));
  if (!project) return { ok: false, error: "That project does not exist." };
  const [journey] = await deps.db.select().from(journeys).where(eq(journeys.id, config.data.journeyId));
  if (!journey || journey.projectId !== project.id) return { ok: false, error: "That journey does not belong to this project.", fieldErrors: { journeyId: "Choose a journey from this project." } };
  const definition = journeyDefinitionSchema.safeParse(journey.definition);
  if (!definition.success) return { ok: false, error: "The saved journey is no longer valid. Save a new version first." };
  const first = definition.data.steps[0];
  if (first?.type !== "navigate") return { ok: false, error: "The journey must start by navigating to a page." };
  const check = checkScanTarget(resolveJourneyUrl(project.origin, first.path), project.origin, deps.allowlist);
  if (!check.ok) return { ok: false, error: check.message };
  for (const target of config.data.targets ?? []) {
    if (!(FAULT_KINDS as readonly string[]).includes(target.fault)) return { ok: false, error: "Unknown fault." };
  }

  const created = await deps.db.transaction(async (tx) => {
    // Serializes capacity checks across concurrent launches.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('faultline:analysis-launch'))`);
    const [perProject] = await tx
      .select({ n: count() })
      .from(scans)
      .where(and(eq(scans.projectId, project.id), eq(scans.scenarioKind, "blast-radius"), inArray(scans.status, [...ACTIVE])));
    if ((perProject?.n ?? 0) > 0) return { ok: false as const, error: "This project already has an analysis queued or running. Wait for it to finish or cancel it." };
    const [total] = await tx
      .select({ n: count() })
      .from(scans)
      .where(and(eq(scans.scenarioKind, "blast-radius"), inArray(scans.status, [...ACTIVE])));
    if ((total?.n ?? 0) >= deps.maxActive) {
      return { ok: false as const, error: `The server is already running ${total?.n} analyses (limit ${deps.maxActive}). Try again when one finishes.` };
    }
    const [scan] = await tx
      .insert(scans)
      .values({
        projectId: project.id,
        targetUrl: check.target.url,
        scenarioKind: "blast-radius",
        scenarioConfig: config.data,
        journeyId: journey.id,
        journeySnapshot: { id: journey.id, lineageId: journey.lineageId, version: journey.version, definition: definition.data },
        createdBy: operator.id,
      })
      .returning({ id: scans.id });
    return { ok: true as const, scanId: scan!.id };
  });
  if (!created.ok) return created;

  try {
    const jobId = await deps.enqueue(created.scanId, { expireInSeconds: ANALYSIS_JOB_EXPIRE_SECONDS });
    await deps.db.update(scans).set({ jobId }).where(eq(scans.id, created.scanId));
  } catch (error) {
    const message = `The analysis could not be queued: ${error instanceof Error ? error.message : String(error)}`;
    await failQueuedScan(deps.db, created.scanId, "enqueue_failed", message);
    return { ok: false, error: message };
  }
  return { ok: true, scanId: created.scanId };
}

/** Parses the launch form into the service input shape. Unknown values are left for schema validation to reject. */
export function analysisInputFromForm(form: FormData) {
  const bool = (name: string) => form.get(name) === "on" || form.get(name) === "true";
  const num = (name: string) => {
    const raw = form.get(name);
    return raw === null || raw === "" ? undefined : Number(raw);
  };
  const targets = form.getAll("target").map(String).filter(Boolean);
  return {
    projectId: String(form.get("projectId") ?? ""),
    config: {
      kind: "blast-radius",
      journeyId: String(form.get("journeyId") ?? ""),
      faults: form.getAll("faults").map(String),
      errorStatus: num("errorStatus"),
      latencyMs: num("latencyMs"),
      includeOffline: bool("includeOffline"),
      includeNarrowViewport: bool("includeNarrowViewport"),
      maxExperiments: num("maxExperiments"),
      confirmFindings: bool("confirmFindings"),
      viewport: String(form.get("viewport") ?? "desktop"),
      // Each target is "<fault>|<dependency key>" from an earlier analysis's dependency list.
      ...(targets.length
        ? {
            targets: targets.map((value) => {
              const split = value.indexOf("|");
              return { fault: value.slice(0, split), dependencyKey: value.slice(split + 1) };
            }),
          }
        : {}),
    },
  };
}
