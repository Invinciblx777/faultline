import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const base = cn(
  "inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 md-title-medium select-none",
  "transition-[filter,background-color,transform,border-radius] duration-200 ease-spring",
  "active:scale-[0.97] active:rounded-lg disabled:pointer-events-none disabled:opacity-40",
  "[&_svg]:size-5 [&_svg]:shrink-0",
);

const variants = {
  filled: "bg-primary text-on-primary hover:brightness-110",
  tonal: "bg-secondary-container text-on-secondary-container hover:brightness-110",
  outlined: "border border-outline text-on-surface hover:bg-surface-high",
  text: "px-4 text-primary hover:bg-surface-high",
} as const;

type ButtonProps = { icon?: ReactNode; fullWidth?: boolean } & ComponentProps<"button">;

function make(variant: keyof typeof variants, name: string) {
  function Component({ icon, fullWidth, className, children, type = "button", ...rest }: ButtonProps) {
    return (
      <button type={type} className={cn(base, variants[variant], fullWidth && "w-full", className)} {...rest}>
        {icon}
        {children}
      </button>
    );
  }
  Component.displayName = name;
  return Component;
}

export const FilledButton = make("filled", "FilledButton");
export const TonalButton = make("tonal", "TonalButton");
export const OutlinedButton = make("outlined", "OutlinedButton");
export const TextButton = make("text", "TextButton");

const iconVariants = {
  standard: "text-on-surface-variant hover:bg-surface-high",
  filled: "bg-primary text-on-primary hover:brightness-110",
  // Coral destructive, as in the reference call-end button.
  destructive: "bg-error text-on-error hover:brightness-110",
} as const;

/** 48px icon button. An accessible label is required because there is no visible text. */
export function IconButton({ variant = "standard", label, className, children, type = "button", ...rest }: { variant?: keyof typeof iconVariants; label: string } & ComponentProps<"button">) {
  return (
    <button type={type} aria-label={label} title={label} className={cn("grid size-12 place-items-center rounded-full transition-[border-radius,filter] duration-200 active:rounded-lg [&_svg]:size-6", iconVariants[variant], className)} {...rest}>
      {children}
    </button>
  );
}
