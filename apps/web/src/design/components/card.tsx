import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type CardTier = "lowest" | "low" | "container" | "high" | "highest";

const tiers: Record<CardTier, string> = {
  lowest: "bg-surface-lowest",
  low: "bg-surface-low",
  container: "bg-surface-container",
  high: "bg-surface-high",
  highest: "bg-surface-highest",
};

/** Tonal card. Elevation is expressed by surface-container tier, never by borders or shadows. */
export function Card({ tier = "container", className, ...rest }: { tier?: CardTier } & ComponentProps<"section">) {
  return <section data-tier={tier} className={cn("rounded-xl p-5 sm:p-6", tiers[tier], className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: ComponentProps<"h2">) {
  return <h2 className={cn("md-title-large text-on-surface", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("md-body-medium text-on-surface-variant", className)} {...rest} />;
}
