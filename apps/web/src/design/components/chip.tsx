import { CircleAlert, CircleCheck, CircleDashed, CircleX, FlaskConicalOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ChipStatus = "broken" | "degraded" | "resilient" | "inconclusive" | "failed" | "neutral";

/** Status tones map onto the scheme; inconclusive and failed also change edge/icon so color is never the only signal. */
export const chipTones: Record<ChipStatus, string> = {
  broken: "bg-error-container text-on-error-container",
  degraded: "bg-tertiary-container text-on-tertiary-container",
  resilient: "bg-secondary-container text-on-secondary-container",
  inconclusive: "bg-surface-high text-on-surface-variant border border-dashed border-outline-variant",
  failed: "bg-surface-highest text-on-surface",
  neutral: "bg-surface-high text-on-surface-variant",
};

const icons: Record<ChipStatus, LucideIcon | null> = {
  broken: CircleX,
  degraded: CircleAlert,
  resilient: CircleCheck,
  inconclusive: CircleDashed,
  failed: FlaskConicalOff,
  neutral: null,
};

export function Chip({ status = "neutral", children, icon, className }: { status?: ChipStatus; children: ReactNode; icon?: LucideIcon | null; className?: string }) {
  const Icon = icon === undefined ? icons[status] : icon;
  return (
    <span data-status={status} className={cn("md-label-medium inline-flex h-8 items-center gap-1.5 rounded-sm px-3 whitespace-nowrap", chipTones[status], className)}>
      {Icon ? <Icon aria-hidden className="size-4" /> : null}
      {children}
    </span>
  );
}
