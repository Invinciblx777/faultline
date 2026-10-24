import { Ban, CircleCheck, CircleDashed, CircleSlash, CircleX, Clock3, LoaderCircle, type LucideIcon } from "lucide-react";
import {
  EXECUTION_OUTCOME_LABELS,
  outcomeTone,
  SCAN_STATUS_LABELS,
  scanStatusTone,
  type EvidenceTone,
  type ExecutionOutcome,
  type ScanStatus,
} from "@faultline/shared";
import { cn } from "@/lib/cn";

const toneClasses: Record<EvidenceTone, string> = {
  failure: "bg-error-container text-on-error-container",
  success: "bg-success-container text-on-success-container",
  running: "bg-primary-container text-on-primary-container",
  incomplete: "border border-dashed border-tertiary bg-surface-high text-tertiary",
  unavailable: "border border-dashed border-outline-variant bg-surface-high text-on-surface-variant",
  neutral: "bg-surface-highest text-on-surface-variant",
};

const toneIcons: Record<EvidenceTone, LucideIcon> = {
  failure: CircleX,
  success: CircleCheck,
  running: LoaderCircle,
  incomplete: CircleDashed,
  unavailable: CircleSlash,
  neutral: Clock3,
};

export function ToneChip({ tone, label, className, icon }: { tone: EvidenceTone; label: string; className?: string; icon?: LucideIcon }) {
  const Icon = icon ?? toneIcons[tone];
  return (
    <span className={cn("md-label-medium inline-flex h-8 items-center gap-1.5 rounded-sm px-3 whitespace-nowrap", toneClasses[tone], className)}>
      <Icon aria-hidden className={cn("size-4", tone === "running" && "animate-spin motion-reduce:animate-none")} />
      {label}
    </span>
  );
}

export function ScanStatusChip({ status, className }: { status: ScanStatus; className?: string }) {
  const tone = scanStatusTone(status);
  return <ToneChip tone={tone} label={SCAN_STATUS_LABELS[status]} className={className} icon={status === "cancelled" ? Ban : undefined} />;
}

export function OutcomeChip({ outcome, className }: { outcome: ExecutionOutcome | null; className?: string }) {
  if (!outcome) return <ToneChip tone="incomplete" label="No outcome" className={className} />;
  return <ToneChip tone={outcomeTone(outcome)} label={EXECUTION_OUTCOME_LABELS[outcome]} className={className} />;
}
