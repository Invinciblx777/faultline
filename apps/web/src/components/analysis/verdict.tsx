import {
  CircleHelp,
  FlaskConicalOff,
  Hourglass,
  LoaderCircle,
  MinusCircle,
  OctagonX,
  ServerCrash,
  ShieldCheck,
  Smartphone,
  Timer,
  TriangleAlert,
  Unplug,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import {
  EXPERIMENT_KIND_LABELS,
  REPRODUCIBILITY_LABELS,
  VERDICT_DEFINITIONS,
  VERDICT_LABELS,
  type ExperimentKind,
  type Reproducibility,
  type Verdict,
} from "@faultline/shared";
import type { ExperimentStatus } from "@faultline/db";
import { cn } from "@/lib/cn";

/** Every verdict has its own icon and label; color is never the only signal. */
export const VERDICT_STYLE: Record<Verdict, { icon: LucideIcon; chip: string; border: string; text: string; dot: string }> = {
  broken: { icon: OctagonX, chip: "bg-failure-container text-on-failure-container", border: "border-failure", text: "text-failure", dot: "bg-failure" },
  degraded: { icon: TriangleAlert, chip: "bg-incomplete-container text-on-incomplete-container", border: "border-incomplete", text: "text-incomplete", dot: "bg-incomplete" },
  resilient: { icon: ShieldCheck, chip: "bg-success-container text-on-success-container", border: "border-success", text: "text-success", dot: "bg-success" },
  inconclusive: { icon: CircleHelp, chip: "border border-dashed border-outline text-on-surface-variant", border: "border-outline border-dashed", text: "text-on-surface-variant", dot: "bg-unavailable" },
  test_failed: { icon: FlaskConicalOff, chip: "border border-dashed border-failure text-failure", border: "border-failure border-dashed", text: "text-failure", dot: "bg-unavailable" },
};

export const KIND_ICON: Record<ExperimentKind, LucideIcon> = {
  unavailable: Unplug,
  "http-error": ServerCrash,
  latency: Timer,
  offline: WifiOff,
  "narrow-viewport": Smartphone,
};

export function VerdictChip({ verdict, className, size = "md" }: { verdict: Verdict; className?: string; size?: "sm" | "md" }) {
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  return (
    <span
      title={VERDICT_DEFINITIONS[verdict]}
      className={cn(
        "type-label inline-flex items-center gap-1.5 rounded-sm whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5",
        style.chip,
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

/** Verdict when one exists; otherwise the experiment's progress state. */
export function ExperimentStateChip({ status, verdict, className }: { status: ExperimentStatus; verdict: Verdict | null; className?: string }) {
  if (verdict) return <VerdictChip verdict={verdict} className={className} />;
  const map = {
    pending: { icon: Hourglass, label: "Waiting", cls: "bg-surface-highest text-on-surface-variant" },
    running: { icon: LoaderCircle, label: "Running", cls: "bg-primary-container text-on-primary-container" },
    skipped: { icon: MinusCircle, label: "Not run", cls: "border border-dashed border-outline text-on-surface-variant" },
    completed: { icon: CircleHelp, label: "No verdict", cls: "border border-dashed border-outline text-on-surface-variant" },
    failed: { icon: FlaskConicalOff, label: "Not completed", cls: "border border-dashed border-failure text-failure" },
  }[status];
  const Icon = map.icon;
  return (
    <span className={cn("type-label inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 whitespace-nowrap", map.cls, className)}>
      <Icon aria-hidden className={cn("size-4", status === "running" && "animate-spin motion-reduce:animate-none")} />
      {map.label}
    </span>
  );
}

export function KindLabel({ kind, className }: { kind: ExperimentKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon aria-hidden className="size-4 shrink-0 text-fault" />
      {EXPERIMENT_KIND_LABELS[kind]}
    </span>
  );
}

export function ReproducibilityNote({ value }: { value: Reproducibility | null }) {
  if (!value || value === "not-applicable") return null;
  return <span className="text-sm text-on-surface-variant">{REPRODUCIBILITY_LABELS[value]}</span>;
}
