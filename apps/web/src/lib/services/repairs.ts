import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  approveRepair,
  cancelRepair,
  experiments,
  loadRepairEvidenceInput,
  projects,
  queueCrossCheck,
  queueVerification,
  recordDevinAccess,
  recordRepairEvent,
  repairRequests,
  requestRepairSync,
  scans,
  sourceRepositories,
  type Database,
  type RepairRequest,
  type SourceRepository,
} from "@faultline/db";
import { buildRepairEvidence, buildRepairPrompt, isRepositoryAuthorized, REPAIR_OPEN_STATUSES, repositoryFullName, repositoryLinkSchema } from "@faultline/shared";
import { evidenceChecksum, sha256Hex } from "@faultline/shared/checksum";
import { checkDevinRepositoryAccess, type DevinClient, type DevinRepositoryAccess, type GitHubClient } from "@faultline/shared/integrations";
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

/** A live repository-access check older than this no longer allows approval. */
export const DEVIN_ACCESS_MAX_AGE_MS = 10 * 60_000;

const sameRepository = (a: { owner: string; name: string }, b: { repoOwner: string; repoName: string }) =>
  `${a.owner}/${a.name}`.toLowerCase() === `${b.repoOwner}/${b.repoName}`.toLowerCase();

/**
 * Why the approval button must stay disabled, judged from the stored check
 * only: the repository must be the one this request was prepared for, and
 * Devin's access to it must have been confirmed live within
 * DEVIN_ACCESS_MAX_AGE_MS. Approval itself checks again live.
 */
export function repositoryAccessBlock(repo: Pick<SourceRepository, "owner" | "name" | "devinStatus" | "devinDetail" | "devinCheckedAt"> | null, repair: Pick<RepairRequest, "repoOwner" | "repoName">, now = new Date()): string | null {
  const target = `${repair.repoOwner}/${repair.repoName}`;
  if (!repo) return "The linked repository no longer exists. Approval is disabled.";
  if (!sameRepository(repo, repair)) return `The project is now linked to ${repo.owner}/${repo.name}, but this request was prepared for ${target}. Create a new repair request.`;
  if (repo.devinStatus !== "ok") return `Devin cannot use ${target}: ${repo.devinDetail ?? "repository access has not been checked."} Approval is disabled until a check succeeds.`;
  if (!repo.devinCheckedAt) return `Devin's access to ${target} has not been checked live. Check repository access before approving.`;
  const age = now.getTime() - repo.devinCheckedAt.getTime();
  if (age > DEVIN_ACCESS_MAX_AGE_MS) return `Devin's access to ${target} was last confirmed ${Math.round(age / 60_000)} minutes ago. Check repository access again before approving.`;
  return null;
}

/**
 * Live check that the repair's exact repository is still linked and visible
 * to the configured Devin organization. The result is stored either way.
 */
async function verifyRepairAccess(deps: RepairServiceDeps, devin: DevinClient, repair: RepairRequest): Promise<DevinRepositoryAccess> {
  const [repo] = await deps.db.select().from(sourceRepositories).where(eq(sourceRepositories.id, repair.repositoryId));
  if (!repo) return { ok: false, code: "repository_unavailable", reason: "The linked repository no longer exists.", checkedAt: new Date() };
  if (!sameRepository(repo, repair)) {
    return { ok: false, code: "repository_unavailable", reason: `The project is now linked to ${repo.owner}/${repo.name}, but this request was prepared for ${repair.repoOwner}/${repair.repoName}.`, checkedAt: new Date() };
  }
  const access = await checkDevinRepositoryAccess(devin, `${repair.repoOwner}/${repair.repoName}`);
  await recordDevinAccess(deps.db, repo.id, access);
  return access;
}

/** GitHub and Devin connection facts for a repository, recorded as they were observed. */
async function checkConnections(deps: RepairServiceDeps, repo: { owner: string; name: string; baseBranch: string }) {
  const result: Pick<SourceRepository, "githubStatus" | "githubDetail" | "baseSha" | "devinStatus" | "devinDetail" | "devinRepoName" | "devinCheckedAt"> & { url: string; canonicalName?: string } = {
    githubStatus: "error",
    githubDetail: null,
    baseSha: null,
    devinStatus: "not_configured",
    devinDetail: deps.devinUnavailable,
    devinRepoName: null,
    devinCheckedAt: null,
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
    const access = await checkDevinRepositoryAccess(deps.devin, result.canonicalName ?? repositoryFullName(repo));
    result.devinCheckedAt = access.checkedAt;
    if (access.ok) {
      result.devinStatus = "ok";
      result.devinRepoName = access.repoName;
      result.devinDetail = `Devin's ${access.host} connection can access ${access.repoName}.`;
    } else {
      result.devinStatus = "error";
      result.devinDetail = access.reason;
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
  const stale = "This request was already approved, cancelled, or its evidence changed. Reload the page.";
  const [repair] = await deps.db.select().from(repairRequests).where(eq(repairRequests.id, input.repairId));
  if (!repair || repair.status !== "awaiting_approval" || repair.evidenceSha256 !== input.evidenceSha256) return { ok: false, error: stale };
  // Never trust a cached check here: confirm Devin's access to this exact repository now.
  const access = await verifyRepairAccess(deps, deps.devin, repair);
  if (!access.ok) return { ok: false, error: `Approval refused; no session was requested. ${access.reason}` };
  // The conditional update still enforces status and checksum atomically.
  const row = await approveRepair(deps.db, input.repairId, { operatorId: operator.id, username: operator.username, statement: APPROVAL_STATEMENT, evidenceSha256: input.evidenceSha256 });
  if (!row) return { ok: false, error: stale };
  await recordRepairEvent(deps.db, row.id, {
    source: "operator",
    kind: "approved",
    message: `Approved by ${operator.username} for evidence checksum ${input.evidenceSha256.slice(0, 16)}…. Devin's access to ${access.repoName} was confirmed live. Queued for the worker to create the Devin session.`,
    operatorId: operator.id,
    detail: { statement: APPROVAL_STATEMENT, evidenceSha256: input.evidenceSha256, repositoryAccess: { repoName: access.repoName, host: access.host, checkedAt: access.checkedAt.toISOString() } },
  });
  return { ok: true };
}

/** Rechecks Devin's live access to a pending repair's repository. Read-only towards Devin. */
export async function checkRepairAccess(deps: RepairServiceDeps, operator: Operator, repairId: string): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success) return { ok: false, error: "Unknown repair request." };
  if (!deps.devin) return { ok: false, error: `Devin is not configured on this server: ${deps.devinUnavailable}` };
  const [repair] = await deps.db.select().from(repairRequests).where(eq(repairRequests.id, repairId));
  if (!repair) return { ok: false, error: "Unknown repair request." };
  const access = await verifyRepairAccess(deps, deps.devin, repair);
  return access.ok ? { ok: true } : { ok: false, error: access.reason };
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

/** Verifies the pull request head against another finding's regression test. Never changes the repair's own verdict. */
export async function requestCrossCheck(deps: RepairServiceDeps, operator: Operator, repairId: string, experimentId: string): Promise<ServiceResult<{ runId: string }>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success || !z.uuid().safeParse(experimentId).success) return { ok: false, error: "Choose a finding to cross-check against." };
  const result = await queueCrossCheck(deps.db, repairId, experimentId, operator.id);
  if (!result.ok) return result;
  await recordRepairEvent(deps.db, repairId, {
    source: "operator",
    kind: "cross_check_requested",
    message: `${operator.username} queued a cross-check of commit ${result.candidateSha.slice(0, 12)} against finding ${experimentId.slice(0, 8)}.`,
    operatorId: operator.id,
    detail: { runId: result.runId, experimentId },
  });
  return { ok: true, runId: result.runId };
}

export async function refreshRepair(deps: RepairServiceDeps, operator: Operator, repairId: string): Promise<ServiceResult<object>> {
  if (!operator) return { ok: false, error: "Sign in first." };
  if (!z.uuid().safeParse(repairId).success) return { ok: false, error: "Unknown repair request." };
  await requestRepairSync(deps.db, repairId);
  return { ok: true };
}
