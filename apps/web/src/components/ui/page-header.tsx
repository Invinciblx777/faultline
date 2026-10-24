import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8">
      {back}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="type-display text-[2.25rem] break-words sm:text-[2.75rem]">{title}</h1>
          {description ? <div className="mt-2 max-w-[68ch] text-on-surface-variant">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
