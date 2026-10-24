import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Android 16 confirmation dialog body: icon on top, title-large, body, a "Keep in mind" bullet list,
 * then full-width actions (filled primary above outlined cancel). Rendered inline or inside a modal.
 */
export function DialogPanel({ icon, title, body, keepInMind, actions, className, titleId, children }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; keepInMind?: ReactNode[]; actions?: ReactNode; className?: string; titleId?: string; children?: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col gap-4 rounded-xl bg-surface-high p-6 text-on-surface sm:p-7", className)}>
      {icon ? <span className="flex justify-center text-secondary [&_svg]:size-8">{icon}</span> : null}
      <h2 id={titleId} className="md-title-large text-center">
        {title}
      </h2>
      {body ? <div className="md-body-medium text-on-surface-variant">{body}</div> : null}
      {keepInMind?.length ? (
        <div className="flex flex-col gap-2">
          <p className="md-title-medium text-secondary">Keep in mind</p>
          <ul className="md-body-medium flex list-disc flex-col gap-1.5 pl-5 text-on-surface-variant marker:text-on-surface-variant">
            {keepInMind.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {children}
      {actions ? <div className="flex flex-col gap-3 pt-2">{actions}</div> : null}
    </section>
  );
}
