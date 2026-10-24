"use client";

import { FlaskConical, MessageSquarePlus, RefreshCw, Send, Wrench, X } from "lucide-react";
import { useActionState, useState } from "react";
import {
  approveRepairAction,
  cancelRepairAction,
  checkRepairAccessAction,
  createRepairAction,
  postVerdictCommentAction,
  recheckRepositoryAction,
  refreshRepairAction,
  verifyRepairAction,
  type RepairFormState,
} from "@/app/actions/repairs";
import { Button } from "@/components/ui/button";

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
        <Button type="submit" size="lg" icon={<Wrench aria-hidden />} disabled={pending}>
          {pending ? "Preparing evidence…" : "Fix with Devin"}
        </Button>
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
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="repairId" value={repairId} />
        <input type="hidden" name="evidenceSha256" value={evidenceSha256} />
        <label className="flex items-start gap-3 rounded-lg border border-outline-variant p-4">
          <input type="checkbox" name="confirm" className="mt-1 size-5 accent-[var(--primary)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!canApprove} />
          <span className="text-sm">
            {statement} <span className="text-on-surface-variant">Repository: {repository}. Evidence checksum {evidenceSha256.slice(0, 16)}….</span>
          </span>
        </label>
        {blockedReason ? <p className="rounded-md border border-dashed border-failure px-4 py-3 text-sm text-failure">{blockedReason}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" icon={<Send aria-hidden />} disabled={!canApprove || !confirmed || pending}>
            {pending ? "Approving…" : "Approve and send to Devin"}
          </Button>
        </div>
        <ErrorNote state={state} />
      </form>
      <form action={cancel}>
        <input type="hidden" name="repairId" value={repairId} />
        <Button type="submit" variant="text" icon={<X aria-hidden />} disabled={cancelling}>
          Cancel request
        </Button>
        <ErrorNote state={cancelState} />
      </form>
    </div>
  );
}

/** Read-only towards Devin: GET /v3/self and the organization's repository list. */
export function CheckRepairAccessButton({ repairId }: { repairId: string }) {
  const [state, action, pending] = useActionState<RepairFormState, FormData>(checkRepairAccessAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="repairId" value={repairId} />
      <div>
        <Button type="submit" variant="outlined" size="sm" icon={<RefreshCw aria-hidden />} disabled={pending}>
          {pending ? "Checking…" : "Check repository access"}
        </Button>
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
      <Button type="submit" variant="outlined" size="sm" icon={<X aria-hidden />} disabled={pending}>
        Cancel before submission
      </Button>
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
        <Button type="submit" size="lg" icon={<FlaskConical aria-hidden />} disabled={pending}>
          {pending ? "Queuing…" : `${again ? "Verify again" : "Verify"} commit ${sha.slice(0, 12)}`}
        </Button>
      </div>
      <p className="text-sm text-on-surface-variant">
        Builds the original and this exact commit in isolated containers and runs the unchanged regression test against both. The pull request&apos;s code runs only inside the container.
      </p>
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
        <Button type="submit" variant="outlined" size="sm" icon={<MessageSquarePlus aria-hidden />} disabled={pending || state.ok}>
          {pending ? "Posting…" : `Post verdict on pull request #${prNumber}`}
        </Button>
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
      <Button type="submit" variant="outlined" size="sm" icon={<RefreshCw aria-hidden />} disabled={pending}>
        {state.ok ? "Sync requested" : "Sync with Devin now"}
      </Button>
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
      <Button type="submit" variant="outlined" size="sm" icon={<RefreshCw aria-hidden />} disabled={pending}>
        {pending ? "Checking…" : "Check connections"}
      </Button>
      <ErrorNote state={state} />
    </form>
  );
}
