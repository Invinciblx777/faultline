import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Level = "low" | "container" | "high";

const levels: Record<Level, string> = {
  low: "bg-surface-low",
  container: "bg-surface-container",
  high: "bg-surface-high",
};

/** A grouped region. Large radius marks top-level groups; nested items use smaller radii. */
export function Surface({ level = "low", className, ...rest }: { level?: Level } & ComponentProps<"section">) {
  return <section className={cn("rounded-xl p-5 sm:p-6", levels[level], className)} {...rest} />;
}

export function SectionTitle({ className, ...rest }: ComponentProps<"h2">) {
  return <h2 className={cn("type-title text-lg text-on-surface", className)} {...rest} />;
}

export function Description({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-on-surface-variant", className)} {...rest} />;
}
