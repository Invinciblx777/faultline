import { eq } from "drizzle-orm";
import {
  artifacts,
  claimRepairSubmission,
  recordRepairEvent,
  repairRequests,
  setRepairStatus,
  sourceRepositories,
  staleSubmissions,
  type ArtifactStorage,
  type Database,
  type DevinAttachmentRecord,
  type RepairRequest,
} from "@faultline/db";
import { buildRepairPrompt, parsePullRequestUrl, sanitizeEvidenceText, validatePullRequest, type RepairStatus } from "@faultline/shared";
import { sha256Hex } from "@faultline/shared/checksum";
import { DevinApiError, devinTimestamp, GitHubApiError, type DevinClient, type DevinSession, type GitHubClient } from "@faultline/shared/integrations";

export interface RepairAgentDeps {
  db: Database;
  storage: ArtifactStorage;
  /** Null when DEVIN_API_KEY / DEVIN_ORG_ID are missing or invalid; `devinUnavailable` says why. */
  devin: DevinClient | null;
  devinUnavailable: string | null;
  github: GitHubClient;
  workerId: string;
  maxAcuLimit: number | null;
  attachScreenshots: boolean;
  log: (message: string, extra?: Record<string, unknown>) => void;
}

/** Submissions without a confirmed session are rechecked by tag for this long before they are called failed. */
export const SUBMISSION_CONFIRM_WINDOW_MS = 10 * 60_000;
/** A submission whose worker has said nothing for this long is treated as interrupted. */
export const SUBMISSION_STALE_MS = 60_000;

/** Session states after which Devin does no more work unless someone messages it. */
const DEVIN_STOPPED = new Set(["exit", "error", "suspended"]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function adoptSession(deps: RepairAgentDeps, repair: RepairRequest, session: DevinSession, how: string) {
  const row = await setRepairStatus(deps.db, repair.id, ["submitting"], "devin_running", `Devin session ${session.session_id} is ${session.status}.`, {
    devinSessionId: session.session_id,
    devinSessionUrl: session.url,
    devinStatus: session.status,
    devinStatusDetail: session.status_detail ?? null,
    devinCreatedAt: devinTimestamp(session.created_at),
    devinUpdatedAt: devinTimestamp(session.updated_at),
    lastSyncedAt: null,
    syncError: null,
  });
  if (row) {
    await recordRepairEvent(deps.db, repair.id, {
      source: "devin",
      kind: "session_created",
      message: `${how} Devin session ${session.session_id} (status ${session.status}).`,
      occurredAt: devinTimestamp(session.created_at),
      detail: { sessionId: session.session_id, url: session.url, status: session.status },
    });
    deps.log("devin session recorded", { repairId: repair.id, sessionId: session.session_id });
  }
}

async function failSubmission(deps: RepairAgentDeps, repairId: string, message: string, detail: Record<string, unknown> = {}) {
  const row = await setRepairStatus(deps.db, repairId, ["submitting"], "devin_failed", message);
  if (row) await recordRepairEvent(deps.db, repairId, { source: "faultline", kind: "submission_failed", message, detail });
}

/** Uploads the stored baseline and under-fault screenshots, after approval, verifying each hash first. */
async function uploadScreenshots(deps: RepairAgentDeps, devin: DevinClient, repair: RepairRequest): Promise<DevinAttachmentRecord[]> {
  const records: DevinAttachmentRecord[] = [];
  for (const ref of repair.evidence.artifacts.slice(0, 2)) {
    const name = `faultline-${ref.run}-${ref.id.slice(0, 8)}.png`;
    try {
      const [row] = await deps.db.select().from(artifacts).where(eq(artifacts.id, ref.id));
      if (!row) throw new Error("artifact row not found");
      const bytes = await deps.storage.getBuffer(row.storageKey);
      if (sha256Hex(bytes) !== ref.sha256) throw new Error("stored bytes do not match the recorded SHA-256");
      const uploaded = await devin.uploadAttachment(name, bytes, "image/png");
      records.push({ artifactId: ref.id, name, sha256: ref.sha256, attachmentId: uploaded.attachment_id, url: uploaded.url, error: null });
    } catch (error) {
      records.push({ artifactId: ref.id, name, sha256: ref.sha256, attachmentId: null, url: null, error: sanitizeEvidenceText(errorText(error), 300) });
    }
  }
  return records;
}

/**
 * Creates the Devin session for one approved repair. The request is claimed
 * first (queued → submitting), so it runs at most once per approval. A
 * response that never arrived is not retried: the session is looked up by
 * its unique tag instead.
 */
export async function submitRepair(deps: RepairAgentDeps, repairId: string): Promise<void> {
  const repair = await claimRepairSubmission(deps.db, repairId, deps.workerId);
  if (!repair) return;
  await recordRepairEvent(deps.db, repair.id, { source: "faultline", kind: "submission_started", message: "Worker claimed the approved request and is creating the Devin session." });
  const devin = deps.devin;
  if (!devin) return failSubmission(deps, repair.id, `Devin is not configured: ${deps.devinUnavailable}`);
  const [repo] = await deps.db.select().from(sourceRepositories).where(eq(sourceRepositories.id, repair.repositoryId));
  if (!repo) return failSubmission(deps, repair.id, "The linked repository no longer exists.");

  const attachments = deps.attachScreenshots ? await uploadScreenshots(deps, devin, repair) : [];
  const delivered = attachments.filter((a) => a.url);
  let prompt: string;
  try {
    prompt = buildRepairPrompt(repair.evidence, delivered.map((a) => ({ name: a.name, artifactId: a.artifactId, sha256: a.sha256 })));
  } catch (error) {
    return failSubmission(deps, repair.id, `The prompt could not be built: ${errorText(error)}`);
  }
  // The stored prompt is exactly what is sent.
  await deps.db.update(repairRequests).set({ attachments, prompt, promptSha256: sha256Hex(prompt), updatedAt: new Date() }).where(eq(repairRequests.id, repair.id));
  if (attachments.length) {
    await recordRepairEvent(deps.db, repair.id, {
      source: "faultline",
      kind: "attachments",
      message: `${delivered.length} of ${attachments.length} screenshots uploaded to Devin as attachments.${attachments.some((a) => a.error) ? ` Failed: ${attachments.filter((a) => a.error).map((a) => `${a.name} (${a.error})`).join("; ")}.` : ""}`,
      detail: { attachments: attachments.map((a) => ({ name: a.name, artifactId: a.artifactId, sha256: a.sha256, delivered: Boolean(a.url), error: a.error })) },
    });
  }

  try {
    const session = await devin.createSession({
      prompt,
      title: `FAULTLINE repair: ${repair.evidence.finding.fault}`.slice(0, 200),
      tags: ["faultline", repair.devinTag],
      repos: [repo.devinRepoName ?? `${repair.repoOwner}/${repair.repoName}`],
      ...(delivered.length ? { attachment_urls: delivered.map((a) => a.url!) } : {}),
      ...(deps.maxAcuLimit ? { max_acu_limit: deps.maxAcuLimit } : {}),
    });
    await adoptSession(deps, repair, session, "Created");
  } catch (error) {
    if (error instanceof DevinApiError && error.ambiguous) {
      // The request may have been processed. Leave it submitting; recovery looks the session up by tag.
      await setRepairStatus(deps.db, repair.id, ["submitting"], "submitting", `No confirmation from Devin yet (${error.category}). FAULTLINE will look the session up by tag instead of creating another one.`);
      await recordRepairEvent(deps.db, repair.id, { source: "faultline", kind: "submission_unconfirmed", message: error.message, detail: { category: error.category } });
      return;
    }
    const category = error instanceof DevinApiError ? error.category : "unknown";
    await failSubmission(deps, repair.id, `Devin did not create a session: ${errorText(error)}`, { category });
  }
}

/** Resolves submissions left without a confirmed session by finding their tagged session; never creates one. */
export async function recoverSubmissions(deps: RepairAgentDeps): Promise<void> {
  const stale = await staleSubmissions(deps.db, SUBMISSION_STALE_MS);
  for (const repair of stale) {
    if (!deps.devin) {
      await failSubmission(deps, repair.id, `The submission was interrupted and Devin is not configured to check it: ${deps.devinUnavailable}`);
      continue;
    }
    try {
      const sessions = await deps.devin.findSessionsByTag(repair.devinTag, repair.submitStartedAt ?? repair.createdAt);
      if (sessions.length > 0) {
        const session = sessions.sort((a, b) => a.created_at - b.created_at)[0]!;
        await adoptSession(deps, repair, session, "Recovered (found by tag after an unconfirmed submission)");
        continue;
      }
      const age = Date.now() - (repair.submitStartedAt?.getTime() ?? 0);
      if (age > SUBMISSION_CONFIRM_WINDOW_MS) {
        await failSubmission(deps, repair.id, `The submission was never confirmed and no Devin session carries tag ${repair.devinTag}. No session was created by FAULTLINE; create a new repair request to try again.`);
      }
    } catch (error) {
      deps.log("submission recovery check failed", { repairId: repair.id, error: errorText(error) });
    }
  }
}

function prFields(pull: Awaited<ReturnType<GitHubClient["getPullRequest"]>>) {
  return {
    prUrl: pull.htmlUrl,
    prNumber: pull.number,
    prState: pull.merged ? "merged" : pull.state,
    prMerged: pull.merged,
    prDraft: pull.draft,
    prTitle: sanitizeEvidenceText(pull.title, 300),
    prBaseRef: pull.baseRef,
    prHeadRef: pull.headRef,
    prHeadSha: pull.headSha,
    prCreatedAt: new Date(pull.createdAt),
    prUpdatedAt: new Date(pull.updatedAt),
    prCheckedAt: new Date(),
  };
}

/**
 * Polls one repair: Devin's session status and new messages, then any pull
 * request the session reports, confirmed against GitHub.
 */
export async function syncRepair(deps: RepairAgentDeps, repair: RepairRequest): Promise<void> {
  const { db } = deps;
  const now = new Date();
  if (!deps.devin || !repair.devinSessionId) {
    await db.update(repairRequests).set({ lastSyncedAt: now, syncError: deps.devin ? "No Devin session id is recorded." : `Devin is not configured: ${deps.devinUnavailable}` }).where(eq(repairRequests.id, repair.id));
    return;
  }
  let session: DevinSession;
  try {
    session = await deps.devin.getSession(repair.devinSessionId);
  } catch (error) {
    const message = errorText(error);
    await db
      .update(repairRequests)
      .set({ lastSyncedAt: now, syncError: message, syncFailures: repair.syncFailures + 1 })
      .where(eq(repairRequests.id, repair.id));
    if (repair.syncFailures === 0) await recordRepairEvent(db, repair.id, { source: "faultline", kind: "sync_error", message: `Could not read the Devin session: ${message}` });
    return;
  }

  if (session.status !== repair.devinStatus || (session.status_detail ?? null) !== repair.devinStatusDetail) {
    await recordRepairEvent(db, repair.id, {
      source: "devin",
      kind: "session_status",
      message: `Devin session status: ${session.status}${session.status_detail ? ` (${session.status_detail})` : ""}.`,
      occurredAt: devinTimestamp(session.updated_at),
      detail: { status: session.status, statusDetail: session.status_detail ?? null },
    });
  }

  // New messages since the stored cursor; event_id de-duplicates re-reads.
  let cursor = repair.messagesCursor;
  try {
    for (let page = 0; page < 5; page++) {
      const result = await deps.devin.listMessages(session.session_id, cursor);
      for (const message of result.items) {
        await recordRepairEvent(db, repair.id, {
          source: message.source === "devin" ? "devin" : "operator",
          kind: "message",
          message: sanitizeEvidenceText(message.message, 4000),
          externalId: `msg:${message.event_id}`,
          occurredAt: devinTimestamp(message.created_at),
          detail: { devinSource: message.source },
        });
      }
      if (result.end_cursor) cursor = result.end_cursor;
      if (!result.has_next_page || !result.end_cursor) break;
    }
  } catch (error) {
    deps.log("devin messages sync failed", { repairId: repair.id, error: errorText(error) });
  }

  const update: Partial<typeof repairRequests.$inferInsert> = {
    devinStatus: session.status,
    devinStatusDetail: session.status_detail ?? null,
    devinUpdatedAt: devinTimestamp(session.updated_at),
    devinAcusConsumed: session.acus_consumed === undefined ? null : Math.round(session.acus_consumed),
    messagesCursor: cursor,
    lastSyncedAt: now,
    syncError: null,
    syncFailures: 0,
  };

  // Pull requests: only GitHub's own answer, for the linked repository, counts.
  let accepted: Awaited<ReturnType<GitHubClient["getPullRequest"]>> | null = null;
  let notes: string[] = [];
  for (const reported of session.pull_requests) {
    const ref = parsePullRequestUrl(reported.pr_url);
    if (!ref || `${ref.owner}/${ref.repo}`.toLowerCase() !== `${repair.repoOwner}/${repair.repoName}`.toLowerCase()) {
      await recordRepairEvent(db, repair.id, {
        source: "faultline",
        kind: "pr_rejected",
        message: `Ignored a pull request outside the linked repository: ${sanitizeEvidenceText(reported.pr_url, 300)}`,
        externalId: `pr-rejected:${reported.pr_url}`,
      });
      continue;
    }
    try {
      const pull = await deps.github.getPullRequest(ref.owner, ref.repo, ref.number);
      const validation = validatePullRequest({ reportedUrl: reported.pr_url, linked: { owner: repair.repoOwner, name: repair.repoName, baseBranch: repair.baseBranch }, repairId: repair.id, pull });
      if (!validation.ok) {
        await recordRepairEvent(db, repair.id, {
          source: "github",
          kind: "pr_rejected",
          message: `Pull request #${pull.number} was not accepted: ${validation.problems.join(" ")}`,
          externalId: `pr-rejected:${reported.pr_url}:${pull.headSha}`,
        });
        continue;
      }
      accepted = pull;
      notes = validation.notes;
      break;
    } catch (error) {
      const message = error instanceof GitHubApiError ? error.message : errorText(error);
      await recordRepairEvent(db, repair.id, { source: "github", kind: "pr_check_failed", message: `Could not confirm ${sanitizeEvidenceText(reported.pr_url, 300)} with GitHub: ${message}`, externalId: `pr-check-failed:${reported.pr_url}:${now.toISOString().slice(0, 13)}` });
    }
  }

  let nextStatus: RepairStatus | null = null;
  let detail: string | null = null;
  if (accepted) {
    Object.assign(update, prFields(accepted), { prNotes: notes });
    if (!repair.prHeadSha) {
      await recordRepairEvent(db, repair.id, {
        source: "github",
        kind: "pr_confirmed",
        message: `GitHub confirms pull request #${accepted.number} in ${repair.repoOwner}/${repair.repoName}: ${accepted.headRef} → ${accepted.baseRef}, head ${accepted.headSha.slice(0, 12)}.`,
        externalId: `pr-confirmed:${accepted.number}`,
        detail: { url: accepted.htmlUrl, headSha: accepted.headSha, baseRef: accepted.baseRef, headRef: accepted.headRef, notes },
      });
    } else if (repair.prHeadSha !== accepted.headSha) {
      await recordRepairEvent(db, repair.id, {
        source: "github",
        kind: "pr_head_changed",
        message: `The pull request head moved from ${repair.prHeadSha.slice(0, 12)} to ${accepted.headSha.slice(0, 12)}.${repair.verifiedSha ? ` The last verdict applies to ${repair.verifiedSha.slice(0, 12)} only.` : ""}`,
        externalId: `pr-head:${accepted.headSha}`,
        detail: { from: repair.prHeadSha, to: accepted.headSha },
      });
    }
    if (repair.status === "devin_running" || repair.status === "devin_finished_no_pr") {
      nextStatus = "ready_for_verification";
      detail = `Pull request #${accepted.number} confirmed by GitHub. Verify commit ${accepted.headSha.slice(0, 12)} independently.`;
    }
  } else if (DEVIN_STOPPED.has(session.status) || session.status_detail === "finished") {
    if (repair.status === "devin_running") {
      nextStatus = session.status === "error" ? "devin_failed" : "devin_finished_no_pr";
      detail = `Devin session is ${session.status}${session.status_detail ? ` (${session.status_detail})` : ""} and no pull request in the linked repository has been confirmed.`;
    }
  }

  if (nextStatus) {
    const row = await setRepairStatus(db, repair.id, [repair.status], nextStatus, detail, update);
    if (row) await recordRepairEvent(db, repair.id, { source: "faultline", kind: "status", message: detail ?? nextStatus });
  } else {
    await db.update(repairRequests).set(update).where(eq(repairRequests.id, repair.id));
  }
}
