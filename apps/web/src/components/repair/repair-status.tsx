import { Ban, BadgeCheck, CircleHelp, GitPullRequest, Hourglass, LoaderCircle, OctagonX, ShieldAlert, ShieldQuestion, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import { REPAIR_STATUS_LABELS, VERIFICATION_VERDICT_DEFINITIONS, type RepairStatus, type VerificationVerdict } from "@faultline/shared";
import { cn } from "@/lib/cn";

/** Verification verdicts: each has its own icon and words; color is never the only signal. */
export const VERIFICATION_STYLE: Record<VerificationVerdict, { icon: LucideIcon; label: string; chip: string; panel: string; text: string }> = {
  verified_fixed: { icon: BadgeCheck, label: "VERIFIED FIXED", chip: "bg-success-container text-on-success-container", panel: "border-success bg-success-container/35", text: "text-success" },
  still_failing: { icon: OctagonX, label: "STILL FAILING", chip: "bg-failure-container text-on-failure-container", panel: "border-failure bg-failure-container/35", text: "text-failure" },
  regression_detected: { icon: TriangleAlert, label: "REGRESSION DETECTED", chip: "bg-incomplete-container text-on-incomplete-container", panel: "border-incomplete bg-incomplete-container/35", text: "text-incomplete" },
  inconclusive: { icon: CircleHelp, label: "INCONCLUSIVE", chip: "border border-dashed border-outline text-on-surface-variant", panel: "border-dashed border-outline", text: "text-on-surface-variant" },
  verification_blocked: { icon: ShieldQuestion, label: "VERIFICATION BLOCKED", chip: "border border-dashed border-failure text-failure", panel: "border-dashed border-failure", text: "text-failure" },
};

export function VerificationVerdictChip({ verdict, className }: { verdict: VerificationVerdict; className?: string }) {
  const style = VERIFICATION_STYLE[verdict];
  const Icon = style.icon;
  return (
    <span title={VERIFICATION_VERDICT_DEFINITIONS[verdict]} className={cn("type-label inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 whitespace-nowrap", style.chip, className)}>
      <Icon aria-hidden className="size-4" />
      {style.label}
    </span>
  );
}

const STATUS_STYLE: Record<RepairStatus, { icon: LucideIcon; chip: string; spin?: boolean }> = {
  awaiting_approval: { icon: Hourglass, chip: "border border-outline text-on-surface" },
  queued: { icon: LoaderCircle, chip: "bg-primary-container text-on-primary-container", spin: true },
  submitting: { icon: LoaderCircle, chip: "bg-primary-container text-on-primary-container", spin: true },
  devin_running: { icon: Wrench, chip: "bg-primary-container text-on-primary-container" },
  devin_finished_no_pr: { icon: ShieldAlert, chip: "border border-dashed border-incomplete text-incomplete" },
  devin_failed: { icon: OctagonX, chip: "border border-dashed border-failure text-failure" },
  ready_for_verification: { icon: GitPullRequest, chip: "bg-normal-container text-on-normal-container" },
  verifying: { icon: LoaderCircle, chip: "bg-primary-container text-on-primary-container", spin: true },
  verified_fixed: { icon: BadgeCheck, chip: VERIFICATION_STYLE.verified_fixed.chip },
  still_failing: { icon: OctagonX, chip: VERIFICATION_STYLE.still_failing.chip },
  regression_detected: { icon: TriangleAlert, chip: VERIFICATION_STYLE.regression_detected.chip },
  inconclusive: { icon: CircleHelp, chip: VERIFICATION_STYLE.inconclusive.chip },
  verification_blocked: { icon: ShieldQuestion, chip: VERIFICATION_STYLE.verification_blocked.chip },
  cancelled: { icon: Ban, chip: "border border-dashed border-outline text-unavailable" },
};

export function RepairStatusChip({ status, className }: { status: RepairStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span className={cn("type-label inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 whitespace-nowrap", style.chip, className)}>
      <Icon aria-hidden className={cn("size-4", style.spin && "animate-spin motion-reduce:animate-none")} />
      {REPAIR_STATUS_LABELS[status]}
    </span>
  );
}
