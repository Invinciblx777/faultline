import { z } from "zod";
import { projects, type Database } from "@faultline/db";
import { findAllowlistMatch, normalizeOrigin, UrlValidationError, type AllowlistEntry } from "@faultline/shared";

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Name the project.").max(80, "Use 80 characters or fewer."),
  origin: z.string().trim().min(1, "Enter the website origin.").max(2048),
  description: z
    .string()
    .trim()
    .max(500, "Use 500 characters or fewer.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type ServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface ProjectServiceDeps {
  db: Database;
  allowlist: AllowlistEntry[];
}

/** Creates a project for an authorized origin. Rejects unauthenticated callers and unlisted origins. */
export async function createProject(
  deps: ProjectServiceDeps,
  operator: { id: string } | null,
  input: unknown,
): Promise<ServiceResult<{ projectId: string }>> {
  if (!operator) return { ok: false, error: "Sign in to create projects." };
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  let origin: string;
  try {
    origin = normalizeOrigin(parsed.data.origin).origin;
  } catch (error) {
    if (error instanceof UrlValidationError) return { ok: false, error: error.message, fieldErrors: { origin: error.message } };
    throw error;
  }
  if (!findAllowlistMatch(origin, deps.allowlist)) {
    const message = `${origin} is not on this server's scan allowlist. An administrator must add it to FAULTLINE_SCAN_ALLOWLIST first.`;
    return { ok: false, error: message, fieldErrors: { origin: message } };
  }
  const [row] = await deps.db
    .insert(projects)
    .values({ name: parsed.data.name, origin, description: parsed.data.description ?? null, createdBy: operator.id })
    .returning({ id: projects.id });
  return { ok: true, projectId: row!.id };
}
