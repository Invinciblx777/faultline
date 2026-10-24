import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  approveRepair,
  cancelRepair,
  experiments,
  loadRepairEvidenceInput,
  projects,
  queueVerification,
  recordRepairEvent,
  repairRequests,
  requestRepairSync,
  scans,
  sourceRepositories,
  type Database,
  type SourceRepository,
} from "@faultline/db";
import { buildRepairEvidence, buildRepairPrompt, isRepositoryAuthorized, REPAIR_OPEN_STATUSES, repositoryFullName, repositoryLinkSchema } from "@faultline/shared";
import { evidenceChecksum, sha256Hex } from "@faultline/shared/checksum";
import type { DevinClient, GitHubClient } from "@faultline/shared/integrations";
import type { ServiceResult } from "./projects";

export interface RepairServiceDeps {
  db: Database;
  /** FAULTLINE_REPAIR_REPOSITORIES (lower-case owner/name). */
  repositoryAllowlist: string[];
  /** FAULTLINE_REPAIR_APPROVERS (lower-case usernames). */
  approvers: string[];
  devin: DevinClient | null;
  devinUnavailable: string | null;
  github: GitHubClient;
}

type Operator = { id: string; username: string } | null;

export const APPROVAL_STATEMENT =
  "I approve sending this evidence package to Devin and allowing Devin to push a new branch and open a pull request in the repository shown. I will review any pull request before merging; FAULTLINE will not merge it.";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** GitHub and Devin connection facts for a repository, recorded as they were observed. */
async function checkConnections(deps: RepairServiceDeps, repo: { owner: string; name: string; baseBranch: string }) {
  const result: Pick<SourceRepository, "githubStatus" | "githubDetail" | "baseSha" | "devinStatus" | "devinDetail" | "devinRepoName"> & { url: string; canonicalName?: string } = {
    githubStatus: "error",
    githubDetail: null,
    baseSha: null,
    devinStatus: "not_configured",
    devinDetail: deps.devinUnavailable,
    devinRepoName: null,
    url: `https://github.com/${repo.owner}/${repo.name}`,
  };
  try {
    const info = await deps.github.getRepository(repo.owner, repo.name);
    if (info.archived) throw new Error("The repository is archived.");
    const branch = await deps.github.getBranch(repo.owner, repo.name, repo.baseBranch);
    result.githubStatus = "ok";
    result.canonicalName = info.full_name;
    result.baseSha = branch.commit.sha;
    result.url = info.html_url;
    result.githubDetail = `${info.full_name} (${info.private ? "private" : "public"}) is readable; ${branch.name} is at ${branch.commit.sha.slice(0, 12)}${branch.protected ? " and protected" : ""}.`;
  } catch (error) {
    result.githubDetail = errorText(error);
  }
  if (deps.devin) {
    try {
      const found = await deps.devin.findRepository(result.canonicalName ?? repositoryFullName(repo));
      if (found) {
        result.devinStatus = "ok";
        result.devinRepoName = found.repo_full_name;
        result.devinDetail = `Devin's ${found.git_connection_host} connection can access ${found.repo_full_name}.`;
      } else {
        result.devinStatus = "error";
        result.devinDetail = `Devin's Git connections do not list ${repositoryFullName(repo)}. In Devin, open Settings → Connections → GitHub and grant the Devin app access to this repository.`;
      }
    } catch (error) {
      result.devinStatus = "error";
      result.devinDetail = errorText(error);
    }
  }
  return result;
}

export function repositoryInputFromForm(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const extra = text("extraPortEnvs");
  return {
    projectId: text("projectId"),
    link: {
      provider: "github",
      owner: text("owner"),
      name: text("name"),
      baseBranch: text("baseBranch") || "main",
      appDir: text("appDir") || null,
      recipe: {
        kind: "node-server",
        entry: text("entry"),
        portEnv: text("portEnv") || "PORT",
        extraPortEnvs: extra ? extra.split(",").map((v) => v.trim()).filter(Boolean) : [],
        hostEnv: text("hostEnv") || null,
      },
    },
  };
}

/**
 * Links (or re-links) a project's source repository. Only repositories on
 * the server's FAULTLINE_REPAIR_REPOSITORIES list may be linked.
 */
export async function linkRepository(deps: RepairServiceDeps, operator: Operator, input: { projectId: string; link: unknown }): Promise<ServiceResult<{ repositoryId: string }>> {
  if (!operator) return { ok: false, error: "Sign in to link repositories." };
  if (!z.uuid().safeParse(input.projectId).success) return { ok: false, error: "Unknown project." };
  const parsed = repositoryLinkSchema.safeParse(input.link);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the highlighted fields.", fieldErrors };
  }
  const link = parsed.data;
  if (!isRepositoryAuthorized(link, deps.repositoryAllowlist)) {
    return {
      ok: false,
      error: `${repositoryFullName(link)} is not authorized for repair on this server. An administrator must add it to FAULTLINE_REPAIR_REPOSITORIES first.`,
      fieldErrors: { name: "Not on FAULTLINE_REPAIR_REPOSITORIES." },
    };
  }
  const [project] = await deps.db.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
  if (!project) return { ok: false, error: "That project does not exist." };
  const { canonicalName, ...checks } = await checkConnections(deps, link);
  // Keep GitHub's own spelling of the name (the allowlist comparison is case-insensitive).
  const [owner, name] = canonicalName?.split("/") ?? [link.owner, link.name];
  const values = {
    projectId: project.id,
    provider: link.provider,
    owner: owner!,
    name: name!,
    baseBranch: link.baseBranch,
    appDir: link.appDir,
    recipe: link.recipe,
    linkedBy: operator.id,
    checkedAt: new Date(),
    updatedAt: new Date(),
    ...checks,
  };
  const [row] = await deps.db
    .insert(sourceRepositories)
    .values(values)
    .onConflictDoUpdate({ target: sourceRepositories.projectId, set: values })
    .returning({ id: sourceRepositories.id });
  return { ok: true, repositoryId: row!.id };
}

export async function recheckRepository(deps: RepairServiceDeps, operator: Operator, repositoryId: string): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repositoryId).success) return { ok: false, error: "Unknown repository." };
  const [repo] = await deps.db.select().from(sourceRepositories).where(eq(sourceRepositories.id, repositoryId));
  if (!repo) return { ok: false, error: "Unknown repository." };
  const { canonicalName, ...checks } = await checkConnections(deps, repo);
  const [owner, name] = canonicalName?.split("/") ?? [repo.owner, repo.name];
  await deps.db.update(sourceRepositories).set({ ...checks, owner: owner!, name: name!, checkedAt: new Date() }).where(eq(sourceRepositories.id, repositoryId));
  return { ok: true };
}

/**
 * Creates a repair request awaiting approval: evidence bundle, checksum, and
 * prompt preview. Nothing is sent anywhere. A second request for the same
 * finding returns the open one instead of creating another.
 */
export async function createRepairRequest(deps: RepairServiceDeps, operator: Operator, experimentId: string): Promise<ServiceResult<{ repairId: string; existing: boolean }>> {
  if (!operator) return { ok: false, error: "Sign in to request repairs." };
  if (!z.uuid().safeParse(experimentId).success) return { ok: false, error: "Unknown finding." };
  const open = async () => {
    const [row] = await deps.db
      .select({ id: repairRequests.id })
      .from(repairRequests)
      .where(and(eq(repairRequests.experimentId, experimentId), inArray(repairRequests.status, [...REPAIR_OPEN_STATUSES])));
    return row ?? null;
  };
  const existing = await open();
  if (existing) return { ok: true, repairId: existing.id, existing: true };

  const [owner] = await deps.db.select({ projectId: scans.projectId }).from(experiments).innerJoin(scans, eq(scans.id, experiments.scanId)).where(eq(experiments.id, experimentId));
  if (!owner) return { ok: false, error: "That finding does not exist." };
  const [repo] = await deps.db.select().from(sourceRepositories).where(eq(sourceRepositories.projectId, owner.projectId));
  if (!repo) return { ok: false, error: "Link this project's source repository first." };
  if (!isRepositoryAuthorized(repo, deps.repositoryAllowlist)) return { ok: false, error: `${repositoryFullName(repo)} is no longer on FAULTLINE_REPAIR_REPOSITORIES.` };

  // The base revision Devin will start from, as GitHub reports it now.
  let baseSha: string;
  try {
    baseSha = (await deps.github.getBranch(repo.owner, repo.name, repo.baseBranch)).commit.sha;
  } catch (error) {
    return { ok: false, error: `GitHub could not resolve ${repositoryFullName(repo)}@${repo.baseBranch}: ${errorText(error)}` };
  }
  const repairId = randomUUID();
  const createdAt = new Date();
  const loaded = await loadRepairEvidenceInput(deps.db, experimentId, repo, { repairRequestId: repairId, createdAt, baseSha });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const evidence = buildRepairEvidence(loaded.input);
  const prompt = buildRepairPrompt(evidence);
  const [row] = await deps.db
    .insert(repairRequests)
    .values({
      id: repairId,
      projectId: loaded.projectId,
      scanId: loaded.scanId,
      experimentId,
      repositoryId: repo.id,
      repoOwner: repo.owner,
      repoName: repo.name,
      baseBranch: repo.baseBranch,
      baseSha,
      evidence,
      evidenceSha256: evidenceChecksum(evidence),
      prompt,
      promptSha256: sha256Hex(prompt),
      regressionTestId: loaded.regressionTestId,
      regressionTestSha256: loaded.input.regressionTest.sha256,
      createdBy: operator.id,
      createdAt,
      devinTag: `faultline-repair-${repairId}`,
      statusDetail: "Review the evidence and approve to create a Devin session.",
    })
    .onConflictDoNothing()
    .returning({ id: repairRequests.id });
  if (!row) {
    // A concurrent request won the unique index; use it.
    const winner = await open();
    if (winner) return { ok: true, repairId: winner.id, existing: true };
    return { ok: false, error: "The repair request could not be created." };
  }
  await recordRepairEvent(deps.db, repairId, {
    source: "operator",
    kind: "created",
    message: `Repair request created by ${operator.username} from finding ${experimentId}. Evidence checksum ${evidenceChecksum(evidence).slice(0, 16)}…; nothing has been sent.`,
    operatorId: operator.id,
  });
  return { ok: true, repairId, existing: false };
}

/**
 * Explicit approval by an authorized operator. The checksum must match the
 * evidence the operator reviewed; the worker creates the session afterwards.
 */
export async function approveRepairRequest(
  deps: RepairServiceDeps,
  operator: Operator,
  input: { repairId: string; evidenceSha256: string; confirmed: boolean },
): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in to approve repairs." };
  if (!deps.approvers.includes(operator.username.toLowerCase())) {
    return { ok: false, error: `${operator.username} is not allowed to approve Devin sessions. An administrator must add the username to FAULTLINE_REPAIR_APPROVERS.` };
  }
  if (!deps.devin) return { ok: false, error: `Devin is not configured on this server: ${deps.devinUnavailable}` };
  if (!input.confirmed) return { ok: false, error: "Confirm the approval statement first." };
  if (!z.uuid().safeParse(input.repairId).success || !/^[0-9a-f]{64}$/.test(input.evidenceSha256)) return { ok: false, error: "Invalid approval request." };
  const row = await approveRepair(deps.db, input.repairId, { operatorId: operator.id, username: operator.username, statement: APPROVAL_STATEMENT, evidenceSha256: input.evidenceSha256 });
  if (!row) return { ok: false, error: "This request was already approved, cancelled, or its evidence changed. Reload the page." };
  await recordRepairEvent(deps.db, row.id, {
    source: "operator",
    kind: "approved",
    message: `Approved by ${operator.username} for evidence checksum ${input.evidenceSha256.slice(0, 16)}…. Queued for the worker to create the Devin session.`,
    operatorId: operator.id,
    detail: { statement: APPROVAL_STATEMENT, evidenceSha256: input.evidenceSha256 },
  });
  return { ok: true };
}

export async function cancelRepairRequest(deps: RepairServiceDeps, operator: Operator, repairId: string): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success) return { ok: false, error: "Unknown repair request." };
  const row = await cancelRepair(deps.db, repairId);
  if (!row) return { ok: false, error: "Only requests that have no Devin session yet can be cancelled here." };
  await recordRepairEvent(deps.db, repairId, { source: "operator", kind: "cancelled", message: `Cancelled by ${operator.username}.`, operatorId: operator.id });
  return { ok: true };
}

export async function requestVerification(deps: RepairServiceDeps, operator: Operator, repairId: string): Promise<ServiceResult<{ runId: string }>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success) return { ok: false, error: "Unknown repair request." };
  const result = await queueVerification(deps.db, repairId, operator.id);
  if (!result.ok) return result;
  await recordRepairEvent(deps.db, repairId, {
    source: "operator",
    kind: "verification_requested",
    message: `${operator.username} queued independent verification of commit ${result.candidateSha.slice(0, 12)}.`,
    operatorId: operator.id,
    detail: { runId: result.runId },
  });
  return { ok: true, runId: result.runId };
}

export async function refreshRepair(deps: RepairServiceDeps, operator: Operator, repairId: string): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success) return { ok: false, error: "Unknown repair request." };
  await requestRepairSync(deps.db, repairId);
  return { ok: true };
}
