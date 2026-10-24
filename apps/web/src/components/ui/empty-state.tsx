import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-outline-variant px-6 py-10 sm:px-10">
      <span className="grid size-14 place-items-center rounded-lg bg-surface-high text-primary">
        <Icon aria-hidden className="size-7" />
      </span>
      <div className="max-w-prose">
        <h2 className="type-headline text-xl">{title}</h2>
        {children ? <div className="mt-1.5 text-on-surface-variant">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
