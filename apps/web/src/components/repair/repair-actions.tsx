"use client";

import { FlaskConical, MessageSquarePlus, RefreshCw, Send, Shield, Wrench, X } from "lucide-react";
import { useActionState, useState } from "react";
import {
  approveRepairAction,
  cancelRepairAction,
  checkRepairAccessAction,
  createRepairAction,
  crossCheckRepairAction,
  postVerdictCommentAction,
  recheckRepositoryAction,
  refreshRepairAction,
  verifyRepairAction,
  type RepairFormState,
} from "@/app/actions/repairs";
import { DialogPanel, FilledButton, OutlinedButton } from "@/design/components";

function ErrorNote({ state }: { state: RepairFormState }) {
  return state.error ? (
    <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
      {state.error}
    </p>
  ) : null;
}

/** Creates a repair request (no external call). The button is disabled while pending so a double click submits once. */
export function CreateRepairButton({ experimentId }: { experimentId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(createRepairAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="experimentId" value={experimentId} />
      <div>
        <FilledButton type="submit" icon={<Wrench aria-hidden />} disabled={pending}>
          {pending ? "Preparing evidence…" : "Fix with Devin"}
        </FilledButton>
      </div>
      <p className="text-sm text-on-surface-variant">Prepares the evidence package and repair prompt for your review. Nothing is sent to Devin until you approve it.</p>
      <ErrorNote state={state} />
    </form>
  );
}

export function ApproveRepairForm({ repairId, evidenceSha256, statement, repository, canApprove, blockedReason }: { repairId: string; evidenceSha256: string; statement: string; repository: string; canApprove: boolean; blockedReason: string | null }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(approveRepairAction, {});
  const [cancelState, cancel, cancelling] = useActionState<RepairFormState, FormData>(cancelRepairAction, {});
  const [confirmed, setConfirmed] = useState(false);
  // Android 16 confirmation dialog layout. Approval still requires the explicit checkbox and a human click.
  return (
    <DialogPanel
      titleId="approve-title"
      icon={<Shield aria-hidden />}
      title="Approve a paid Devin repair?"
      className="mx-auto w-full max-w-xl"
      body={
        <p>
          Repository: {repository}. Evidence checksum <span className="font-mono">{evidenceSha256.slice(0, 16)}…</span>
        </p>
      }
      keepInMind={[
        "Devin credits are spent once the session starts.",
        `Devin may push a branch and open a pull request against ${repository}.`,
        "FAULTLINE never merges the pull request; a person decides.",
        "The sanitized evidence package and the repair prompt are shared with Devin.",
      ]}
    >
      <form id="approve-form" action={action} className="flex flex-col gap-4">
        <input type="hidden" name="repairId" value={repairId} />
        <input type="hidden" name="evidenceSha256" value={evidenceSha256} />
        <label className="md-body-medium flex min-h-12 items-start gap-3 rounded-lg bg-surface-container p-4">
          <input type="checkbox" name="confirm" className="mt-0.5 size-5 accent-[var(--primary)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!canApprove} />
          <span>{statement}</span>
        </label>
        {blockedReason ? <p className="md-body-medium rounded-md border border-dashed border-failure px-4 py-3 text-failure">{blockedReason}</p> : null}
        <FilledButton type="submit" fullWidth icon={<Send aria-hidden />} disabled={!canApprove || !confirmed || pending}>
          {pending ? "Approving…" : "Approve repair"}
        </FilledButton>
        <ErrorNote state={state} />
      </form>
      <form action={cancel} className="flex flex-col gap-2">
        <input type="hidden" name="repairId" value={repairId} />
        <OutlinedButton type="submit" fullWidth icon={<X aria-hidden />} disabled={cancelling}>
          Cancel request
        </OutlinedButton>
        <ErrorNote state={cancelState} />
      </form>
    </DialogPanel>
  );
}

/** Read-only towards Devin: GET /v3/self and the organization's repository list. */
export function CheckRepairAccessButton({ repairId }: { repairId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(checkRepairAccessAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="repairId" value={repairId} />
      <div>
        <OutlinedButton className="min-h-10 px-4" type="submit" icon={<RefreshCw aria-hidden />} disabled={pending}>
          {pending ? "Checking…" : "Check repository access"}
        </OutlinedButton>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function CancelQueuedButton({ repairId }: { repairId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(cancelRepairAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="repairId" value={repairId} />
      <OutlinedButton className="min-h-10 px-4" type="submit" icon={<X aria-hidden />} disabled={pending}>
        Cancel before submission
      </OutlinedButton>
      <ErrorNote state={state} />
    </form>
  );
}

export function VerifyButton({ repairId, sha, again }: { repairId: string; sha: string; again: boolean }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(verifyRepairAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="repairId" value={repairId} />
      <div>
        <FilledButton type="submit" icon={<FlaskConical aria-hidden />} disabled={pending}>
          {pending ? "Queuing…" : `${again ? "Verify again" : "Verify"} commit ${sha.slice(0, 12)}`}
        </FilledButton>
      </div>
      <p className="text-sm text-on-surface-variant">
        Builds the original and this exact commit in isolated containers and runs the unchanged regression test against both. The pull request&apos;s code runs only inside the container.
      </p>
      <ErrorNote state={state} />
    </form>
  );
}

/** Queues a cross-check: the same commit judged by another finding's unchanged regression test. Free; no Devin call. */
export function CrossCheckForm({ repairId, sha, findings }: { repairId: string; sha: string; findings: Array<{ experimentId: string; label: string }> }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(crossCheckRepairAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="repairId" value={repairId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-on-surface-variant">Finding whose regression test judges commit {sha.slice(0, 12)}</span>
        <select name="experimentId" required className="h-12 rounded-md border border-outline bg-surface-low px-3 text-on-surface">
          {findings.map((f) => (
            <option key={f.experimentId} value={f.experimentId}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <OutlinedButton type="submit" icon={<FlaskConical aria-hidden />} disabled={pending}>
          {pending ? "Queuing…" : "Cross-check this commit"}
        </OutlinedButton>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

/** Posts the verdict comment. The server checks for an existing comment first, so a second click never posts twice. */
export function PostVerdictCommentButton({ repairId, prNumber }: { repairId: string; prNumber: number }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(postVerdictCommentAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="repairId" value={repairId} />
      <div>
        <OutlinedButton className="min-h-10 px-4" type="submit" icon={<MessageSquarePlus aria-hidden />} disabled={pending || state.ok}>
          {pending ? "Posting…" : `Post verdict on pull request #${prNumber}`}
        </OutlinedButton>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function RefreshRepairButton({ repairId }: { repairId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(refreshRepairAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="repairId" value={repairId} />
      <OutlinedButton className="min-h-10 px-4" type="submit" icon={<RefreshCw aria-hidden />} disabled={pending}>
        {state.ok ? "Sync requested" : "Sync with Devin now"}
      </OutlinedButton>
      <ErrorNote state={state} />
    </form>
  );
}

export function RecheckRepositoryButton({ repositoryId, projectId }: { repositoryId: string; projectId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(recheckRepositoryAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="repositoryId" value={repositoryId} />
      <input type="hidden" name="projectId" value={projectId} />
      <OutlinedButton className="min-h-10 px-4" type="submit" icon={<RefreshCw aria-hidden />} disabled={pending}>
        {pending ? "Checking…" : "Check connections"}
      </OutlinedButton>
      <ErrorNote state={state} />
    </form>
  );
}
