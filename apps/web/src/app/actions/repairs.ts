"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { postVerificationComment } from "@faultline/db";
import { requireOperator } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { getRepairDeps } from "@/lib/integrations";
import {
  approveRepairRequest,
  cancelRepairRequest,
  checkRepairAccess,
  createRepairRequest,
  linkRepository,
  recheckRepository,
  refreshRepair,
  requestCrossCheck,
  repositoryInputFromForm,
  requestVerification,
} from "@/lib/services/repairs";

export interface RepairFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

export async function linkRepositoryAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const input = repositoryInputFromForm(form);
  const result = await linkRepository(getRepairDeps(), operator, input);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  // Same path plus a hash would otherwise keep the cached page with the old form.
  revalidatePath(`/projects/${input.projectId}`);
  redirect(`/projects/${input.projectId}#source-repository`);
}

export async function recheckRepositoryAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const result = await recheckRepository(getRepairDeps(), operator, String(form.get("repositoryId") ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/projects/${String(form.get("projectId") ?? "")}`);
  return { ok: true };
}

export async function createRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const result = await createRepairRequest(getRepairDeps(), operator, String(form.get("experimentId") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect(`/repairs/${result.repairId}`);
}

export async function approveRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await approveRepairRequest(getRepairDeps(), operator, {
    repairId,
    evidenceSha256: String(form.get("evidenceSha256") ?? ""),
    confirmed: form.get("confirm") === "on",
  });
  if (!result.ok) return { error: result.error };
  revalidatePath(`/repairs/${repairId}`);
  return { ok: true };
}

export async function checkRepairAccessAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await checkRepairAccess(getRepairDeps(), operator, repairId);
  // The stored result changed either way, so the approval gate must re-render.
  revalidatePath(`/repairs/${repairId}`);
  if (!result.ok) return { error: result.error };
  return { ok: true };
}

export async function cancelRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await cancelRepairRequest(getRepairDeps(), operator, repairId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/repairs/${repairId}`);
  return { ok: true };
}

export async function verifyRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await requestVerification(getRepairDeps(), operator, repairId);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/repairs/${repairId}`);
  return { ok: true };
}

export async function crossCheckRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await requestCrossCheck(getRepairDeps(), operator, repairId, String(form.get("experimentId") ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/repairs/${repairId}`);
  return { ok: true };
}

export async function refreshRepairAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  const repairId = String(form.get("repairId") ?? "");
  const result = await refreshRepair(getRepairDeps(), operator, repairId);
  if (!result.ok) return { error: result.error };
  return { ok: true };
}

/** Posts FAULTLINE's verdict on the pull request, at most once per verification run. Approvers only: it writes to GitHub. */
export async function postVerdictCommentAction(_prev: RepairFormState, form: FormData): Promise<RepairFormState> {
  const operator = await requireOperator();
  if (!getEnv().FAULTLINE_REPAIR_APPROVERS.includes(operator.username.toLowerCase())) return { error: `${operator.username} is not on FAULTLINE_REPAIR_APPROVERS, so this account cannot comment on pull requests.` };
  const repairId = String(form.get("repairId") ?? "");
  const deps = getRepairDeps();
  const template = process.env.FAULTLINE_COMMENT_IMAGE_URL?.trim();
  const imageUrl = template?.includes("{sha256}") ? (sha: string) => template.replace("{sha256}", sha) : undefined;
  const result = await postVerificationComment(deps.db, deps.github, repairId, { imageUrl, operatorId: operator.id });
  revalidatePath(`/repairs/${repairId}`);
  if (!result.ok) return { error: `${result.error} Download the verdict report (Markdown) and paste it into the pull request instead.` };
  return { ok: true };
}

export interface ConnectionTestState {
  ok?: boolean;
  message?: string;
}

/** Calls GET /v3/self only. It validates the key without creating sessions or spending credits. */
export async function testDevinConnectionAction(): Promise<ConnectionTestState> {
  await requireOperator();
  const deps = getRepairDeps();
  if (!deps.devin) return { ok: false, message: deps.devinUnavailable ?? "Devin is not configured." };
  try {
    const self = await deps.devin.self();
    const who = self.service_user_name ?? self.user_name ?? self.principal_type;
    const orgNote = self.org_id && self.org_id !== process.env.DEVIN_ORG_ID?.trim() ? ` Warning: the key belongs to ${self.org_id}, not DEVIN_ORG_ID.` : "";
    return { ok: !orgNote, message: `Authenticated as ${who} (${self.principal_type}).${orgNote}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
