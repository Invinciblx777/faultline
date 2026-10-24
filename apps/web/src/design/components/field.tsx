import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// M3 filled text field: 16px corners on surface-container-highest, no outline at rest, a primary
// ring on focus and an error ring when invalid. The label floats above the value inside the field.
export const inputClasses = cn(
  "w-full rounded-md bg-surface-highest px-4 text-base text-on-surface placeholder:text-on-surface-variant",
  "transition-[box-shadow] duration-150 focus:outline-none focus:ring-2 focus:ring-primary",
  "aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-error",
);

/** Dropdowns render as pills. */
export const selectClasses = cn(inputClasses, "rounded-full pr-10");

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
      <div className="relative [&>:is(input,select,textarea)]:pt-6 [&>:is(input,select,textarea)]:pb-2 [&>select]:rounded-md">
        <label htmlFor={id} className="pointer-events-none absolute top-2 left-4 z-10 md-label-medium text-on-surface-variant">
          {label}
        </label>
        {children({ id, describedBy, invalid: Boolean(error) })}
      </div>
      {hint && !error ? (
        <p id={hintId} className="px-4 md-label-medium text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="px-4 md-body-medium text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(inputClasses, "h-14", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClasses, "min-h-28", className)} {...rest} />;
}
