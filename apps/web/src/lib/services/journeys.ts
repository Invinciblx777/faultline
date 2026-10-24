import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { journeys, projects, type Database } from "@faultline/db";
import { journeyDefinitionSchema, resolveJourneyUrl, type JourneyDefinition } from "@faultline/shared";
import type { ServiceResult } from "./projects";

export interface JourneyServiceDeps {
  db: Database;
}

function definitionErrors(error: z.ZodError): ServiceResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[issue.path.join(".") || "definition"] ??= issue.message;
  const first = error.issues[0];
  const where = first?.path.length ? ` (${first.path.join(".")})` : "";
  return { ok: false, error: `The journey is not valid${where}: ${first?.message ?? "unknown problem"}.`, fieldErrors };
}

function parseDefinition(origin: string, input: unknown): { ok: true; definition: JourneyDefinition } | ServiceResult<never> {
  const parsed = journeyDefinitionSchema.safeParse(input);
  if (!parsed.success) return definitionErrors(parsed.error);
  for (const [index, step] of parsed.data.steps.entries()) {
    if (step.type !== "navigate") continue;
    try {
      resolveJourneyUrl(origin, step.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, fieldErrors: { [`steps.${index}.path`]: message } };
    }
  }
  return { ok: true, definition: parsed.data };
}

/**
 * Creates version 1 of a new journey. Journeys are data (a fixed set of step
 * types with structured locators); nothing in them is executed as code.
 */
export async function createJourney(
  deps: JourneyServiceDeps,
  operator: { id: string } | null,
  input: { projectId: string; definition: unknown },
): Promise<ServiceResult<{ journeyId: string }>> {
  if (!operator) return { ok: false, error: "Sign in to create journeys." };
  if (!z.uuid().safeParse(input.projectId).success) return { ok: false, error: "Unknown project." };
  const [project] = await deps.db.select().from(projects).where(eq(projects.id, input.projectId));
  if (!project) return { ok: false, error: "That project does not exist." };
  const result = parseDefinition(project.origin, input.definition);
  if (!result.ok) return result;
  const [row] = await deps.db
    .insert(journeys)
    .values({ projectId: project.id, lineageId: randomUUID(), version: 1, name: result.definition.name, definition: result.definition, createdBy: operator.id })
    .returning({ id: journeys.id });
  return { ok: true, journeyId: row!.id };
}

/**
 * Saves an edit as a new immutable version in the same lineage. Earlier
 * versions stay untouched so past analyses keep pointing at what they ran.
 */
export async function reviseJourney(
  deps: JourneyServiceDeps,
  operator: { id: string } | null,
  input: { journeyId: string; definition: unknown },
): Promise<ServiceResult<{ journeyId: string; version: number }>> {
  if (!operator) return { ok: false, error: "Sign in to edit journeys." };
  if (!z.uuid().safeParse(input.journeyId).success) return { ok: false, error: "Unknown journey." };
  const [existing] = await deps.db
    .select({ journey: journeys, origin: projects.origin })
    .from(journeys)
    .innerJoin(projects, eq(projects.id, journeys.projectId))
    .where(eq(journeys.id, input.journeyId));
  if (!existing) return { ok: false, error: "That journey does not exist." };
  const result = parseDefinition(existing.origin, input.definition);
  if (!result.ok) return result;
  // Retry once if another save took the next version number concurrently.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [latest] = await deps.db
      .select({ version: journeys.version })
      .from(journeys)
      .where(eq(journeys.lineageId, existing.journey.lineageId))
      .orderBy(desc(journeys.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    try {
      const [row] = await deps.db
        .insert(journeys)
        .values({
          projectId: existing.journey.projectId,
          lineageId: existing.journey.lineageId,
          version,
          name: result.definition.name,
          definition: result.definition,
          createdBy: operator.id,
        })
        .returning({ id: journeys.id });
      return { ok: true, journeyId: row!.id, version };
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code !== "23505" || attempt === 1) throw error;
    }
  }
  return { ok: false, error: "The journey could not be saved. Try again." };
}

/** The newest version in a journey's lineage. */
export async function latestVersionOf(db: Database, lineageId: string) {
  const [row] = await db.select().from(journeys).where(eq(journeys.lineageId, lineageId)).orderBy(desc(journeys.version)).limit(1);
  return row ?? null;
}
