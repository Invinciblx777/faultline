import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputClasses = cn(
  "w-full rounded-md border border-outline bg-transparent px-4 text-base text-on-surface placeholder:text-outline",
  "transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40",
  "aria-[invalid=true]:border-failure aria-[invalid=true]:ring-failure/30",
);

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label, control, and supporting text wired together for assistive technology. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="type-label text-on-surface">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error ? (
        <p id={hintId} className="text-sm text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-failure" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(inputClasses, "h-12", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClasses, "min-h-24 py-3", className)} {...rest} />;
}
