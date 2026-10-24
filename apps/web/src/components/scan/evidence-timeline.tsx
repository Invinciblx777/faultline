import {
  AlertTriangle,
  Ban,
  CircleDot,
  FileWarning,
  Navigation,
  ScrollText,
  ShieldAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { EVIDENCE_KIND_LABELS, type EvidenceKind } from "@faultline/shared";
import { cn } from "@/lib/cn";
import type { ScanDetail } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/format";

type Event = ScanDetail["executions"][number]["events"][number];

const KIND_ICON: Record<EvidenceKind, LucideIcon> = {
  lifecycle: CircleDot,
  navigation: Navigation,
  console: ScrollText,
  page_error: AlertTriangle,
  request_failed: Unplug,
  http_error: FileWarning,
  fault_injected: Ban,
  policy_block: ShieldAlert,
};

const SEVERITY_TEXT = { info: "text-on-surface-variant", warning: "text-incomplete", error: "text-failure" } as const;

export const PROBLEM_KINDS: EvidenceKind[] = ["page_error", "console", "request_failed", "http_error", "policy_block"];

function offset(ms: number) {
  return `+${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Readable, ordered list of what one execution observed. Page text is rendered as plain text only. */
export function EvidenceTimeline({ events, emptyText = "Nothing recorded." }: { events: Event[]; emptyText?: string }) {
  if (events.length === 0) return <p className="text-sm text-on-surface-variant">{emptyText}</p>;
  return (
    <ol className="flex flex-col">
      {events.map((event) => {
        const Icon = KIND_ICON[event.kind];
        const fault = event.kind === "fault_injected";
        return (
          <li key={event.id} className="grid grid-cols-[3.75rem_1.25rem_1fr] gap-x-2 border-b border-outline-variant/60 py-2.5 last:border-0">
            <time dateTime={event.occurredAt.toISOString()} title={formatDateTime(event.occurredAt)} className="tabular pt-0.5 text-xs text-on-surface-variant">
              {offset(event.offsetMs)}
            </time>
            <Icon aria-hidden className={cn("mt-0.5 size-4", fault ? "text-fault" : SEVERITY_TEXT[event.severity])} />
            <div className="min-w-0">
              <p className="text-sm">
                <span className={cn("type-label mr-2 text-xs", fault ? "text-fault" : SEVERITY_TEXT[event.severity])}>{EVIDENCE_KIND_LABELS[event.kind]}</span>
                <span className="break-words whitespace-pre-wrap">{event.message}</span>
              </p>
              {event.url ? (
                <p className="mt-0.5 text-xs break-all text-on-surface-variant">
                  {event.method && event.method !== "GET" ? `${event.method} ` : ""}
                  {event.url}
                  {event.resourceType ? <span className="ml-1.5">({event.resourceType})</span> : null}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function problemEvents(events: Event[]) {
  return events.filter((e) => PROBLEM_KINDS.includes(e.kind) && e.severity !== "info");
}
