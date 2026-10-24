import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Hero number (display-large) with an optional caption, e.g. "3 of 9 dependencies break the journey". */
export function DisplayNumeral({ value, caption, className, tone = "text-on-surface" }: { value: ReactNode; caption?: ReactNode; className?: string; tone?: string }) {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("md-display-large tabular", tone)}>{value}</span>
      {caption ? <span className="md-body-medium text-on-surface-variant">{caption}</span> : null}
    </span>
  );
}
