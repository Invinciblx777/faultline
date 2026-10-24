import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Gap-separated pill rows (Android 16 settings lists). No dividers: rows are separated by 2px of
 * the parent surface, outer corners are large and inner corners small.
 */
export function ListGroup({ className, ...rest }: ComponentProps<"ul">) {
  return <ul className={cn("flex flex-col gap-0.5 [&>li]:rounded-sm [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg", className)} {...rest} />;
}

export function ListItem({ leading, headline, supporting, trailing, overline, className, tier = "container" }: { leading?: ReactNode; headline: ReactNode; supporting?: ReactNode; trailing?: ReactNode; overline?: ReactNode; className?: string; tier?: "container" | "high" | "low" }) {
  const bg = { container: "bg-surface-container", high: "bg-surface-high", low: "bg-surface-low" }[tier];
  return (
    <li className={cn("flex min-h-14 items-center gap-4 px-4 py-3", bg, className)}>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {overline ? <span className="md-label-medium text-on-surface-variant">{overline}</span> : null}
        <span className="md-title-medium text-on-surface">{headline}</span>
        {supporting ? <span className="md-body-medium text-on-surface-variant">{supporting}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </li>
  );
}
