import { Check, Circle, CircleDot, LoaderCircle, Minus, X } from "lucide-react";
import type { RepairRequest, VerificationRun } from "@faultline/db";
import { cn } from "@/lib/cn";

type StepState = "done" | "current" | "failed" | "pending" | "skipped";

export interface RepairStep {
  key: string;
  label: string;
  state: StepState;
  note: string;
  /** True only while a worker is actually doing this step (shows a spinner). */
  busy?: boolean;
}

/** Derives each stage of FINDING → … → VERDICT from stored facts only. */
export function repairSteps(repair: RepairRequest, latestRun: VerificationRun | null): RepairStep[] {
  const s = repair.status;
  const cancelled = s === "cancelled";
  const steps: RepairStep[] = [
    { key: "finding", label: "Finding", state: "done", note: repair.evidence.finding.verdict },
    { key: "evidence", label: "Evidence", state: "done", note: `checksum ${repair.evidenceSha256.slice(0, 8)}` },
    {
      key: "approval",
      label: "Approval",
      state: repair.approvedAt ? "done" : cancelled ? "skipped" : "current",
      note: repair.approvedAt ? `by ${repair.approvedByUsername}` : cancelled ? "cancelled" : "waiting for an operator",
    },
    {
      key: "devin",
      label: "Devin session",
      state: repair.devinSessionId ? (s === "devin_failed" ? "failed" : "done") : s === "devin_failed" ? "failed" : s === "queued" || s === "submitting" ? "current" : cancelled ? "skipped" : "pending",
      note: repair.devinSessionId ? (repair.devinStatus ?? "created") : s === "devin_failed" ? "not created" : s === "queued" || s === "submitting" ? "creating" : "not started",
      busy: s === "queued" || s === "submitting",
    },
    {
      key: "pr",
      label: "Pull request",
      state: repair.prHeadSha ? "done" : s === "devin_running" ? "current" : s === "devin_finished_no_pr" || (s === "devin_failed" && repair.devinSessionId) ? "failed" : cancelled ? "skipped" : "pending",
      note: repair.prNumber ? `#${repair.prNumber} confirmed by GitHub` : s === "devin_running" ? "waiting for Devin" : s === "devin_finished_no_pr" ? "none opened" : "none yet",
      busy: s === "devin_running" && !repair.prHeadSha,
    },
    {
      key: "verification",
      label: "Verification",
      state: latestRun ? (latestRun.status === "queued" || latestRun.status === "running" ? "current" : latestRun.status === "completed" ? "done" : "failed") : repair.prHeadSha ? "current" : cancelled ? "skipped" : "pending",
      note: latestRun ? `${latestRun.status} · ${latestRun.candidateSha.slice(0, 8)}` : repair.prHeadSha ? "ready to run" : "needs a pull request",
      busy: latestRun?.status === "queued" || latestRun?.status === "running",
    },
    {
      key: "verdict",
      label: "Verdict",
      state: repair.verdict ? (repair.verdict === "verified_fixed" ? "done" : "failed") : cancelled ? "skipped" : "pending",
      note: repair.verdict ? repair.verdict.replace(/_/g, " ") : "not decided",
    },
  ];
  return steps;
}

const ICON: Record<StepState, typeof Check> = { done: Check, current: CircleDot, failed: X, pending: Circle, skipped: Minus };
const DOT: Record<StepState, string> = {
  done: "bg-primary text-on-primary",
  current: "bg-primary-container text-on-primary-container ring-4 ring-primary/25",
  failed: "bg-failure-container text-on-failure-container",
  pending: "border border-outline-variant text-outline",
  skipped: "border border-dashed border-outline-variant text-outline",
};

export function RepairStepper({ steps }: { steps: RepairStep[] }) {
  return (
    <ol aria-label="Repair progress" className="repair-stepper -mx-1 flex snap-x gap-1 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-7 lg:overflow-visible">
      {steps.map((step, i) => {
        const Icon = step.busy ? LoaderCircle : ICON[step.state];
        return (
          <li key={step.key} className="relative flex min-w-[8.5rem] snap-start flex-col gap-2 rounded-lg px-3 py-3 lg:min-w-0" aria-current={step.state === "current" ? "step" : undefined}>
            <div className="flex items-center gap-2">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-300 ease-emphasized", DOT[step.state])}>
                <Icon aria-hidden className={cn("size-4", step.busy && "animate-spin motion-reduce:animate-none")} />
              </span>
              {i < steps.length - 1 ? <span aria-hidden className={cn("h-0.5 flex-1 rounded-full", step.state === "done" ? "bg-primary" : "bg-outline-variant")} /> : null}
            </div>
            <span className="type-label text-on-surface">
              <span className="sr-only">
                Step {i + 1}: {step.state}.{" "}
              </span>
              {step.label}
            </span>
            <span className="text-xs break-words text-on-surface-variant">{step.note}</span>
          </li>
        );
      })}
    </ol>
  );
}
