import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "filled" | "tonal" | "outlined" | "text" | "danger";
type Size = "md" | "lg" | "sm";

const variants: Record<Variant, string> = {
  filled: "bg-primary text-on-primary hover:brightness-110 active:brightness-95",
  tonal: "bg-primary-container text-on-primary-container hover:brightness-110",
  outlined: "border border-outline text-on-surface hover:bg-surface-high",
  text: "text-primary hover:bg-surface-high",
  danger: "bg-failure-container text-on-failure-container hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 gap-1.5 text-sm",
  md: "h-11 px-5 gap-2 text-[0.9375rem]",
  lg: "h-14 px-7 gap-2.5 text-base",
};

export function buttonClasses(variant: Variant = "filled", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none",
    "transition-[filter,background-color,transform,border-radius] duration-200 ease-emphasized",
    "active:scale-[0.97] active:rounded-xl disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:size-[1.15em] [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    extra,
  );
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Button({ variant, size, icon, children, className, ...rest }: CommonProps & ComponentProps<"button">) {
  return (
    <button className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({
  variant,
  size,
  icon,
  children,
  className,
  ...rest
}: CommonProps & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
