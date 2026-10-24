import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Android 16 notification layout: app icon + source + time, title, body, optional actions row,
 * optional thumbnail, trailing chevron. With `href` the whole card is one link.
 */
export function NotificationCard({ icon, source, time, title, body, actions, thumbnail, href, className, children, tier = "container" }: { icon?: ReactNode; source: ReactNode; time?: ReactNode; title: ReactNode; body?: ReactNode; actions?: ReactNode; thumbnail?: ReactNode; href?: string; className?: string; children?: ReactNode; tier?: "container" | "high" }) {
  const bg = tier === "high" ? "bg-surface-high" : "bg-surface-container";
  const hover = tier === "high" ? "hover:bg-surface-highest" : "hover:bg-surface-high";
  const content = (
    <>
      {icon ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container [&_svg]:size-5">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="md-label-medium flex flex-wrap items-center gap-x-1.5 text-on-surface-variant">
          <span>{source}</span>
          {time ? (
            <>
              <span aria-hidden>•</span>
              <span>{time}</span>
            </>
          ) : null}
        </span>
        <span className="md-title-medium break-words text-on-surface">{title}</span>
        {body ? <span className="md-body-medium text-on-surface-variant">{body}</span> : null}
        {children}
      </span>
      {thumbnail ? <span className="shrink-0 overflow-hidden rounded-md">{thumbnail}</span> : null}
      {href ? <ChevronRight aria-hidden className="size-5 shrink-0 self-center text-on-surface-variant" /> : null}
    </>
  );
  const cls = cn("flex items-start gap-4 px-4 py-4", bg, className);
  return (
    <div className="flex flex-col">
      {href ? (
        <Link href={href} className={cn(cls, "transition-colors", hover)}>
          {content}
        </Link>
      ) : (
        <div className={cls}>{content}</div>
      )}
      {actions ? <div className={cn("flex flex-wrap gap-2 px-4 pb-3 pl-18", bg)}>{actions}</div> : null}
    </div>
  );
}
