import {
  AlertTriangle,
  Ban,
  Camera,
  CheckSquare,
  Footprints,
  CircleDot,
  FileWarning,
  Navigation,
  ScrollText,
  ShieldAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { EVIDENCE_KIND_LABELS, type EvidenceKind } from "@faultline/shared";
import { Chip, type ChipStatus } from "@/design/components";
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
  journey_step: Footprints,
  assertion: CheckSquare,
  screenshot: Camera,
};

const SEVERITY_TEXT = { info: "text-on-surface-variant", warning: "text-tertiary", error: "text-failure" } as const;
const SEVERITY_CHIP: Record<keyof typeof SEVERITY_TEXT, { status: ChipStatus; label: string }> = {
  info: { status: "neutral", label: "Info" },
  warning: { status: "degraded", label: "Warning" },
  error: { status: "broken", label: "Error" },
};

export const PROBLEM_KINDS: EvidenceKind[] = ["page_error", "console", "request_failed", "http_error", "policy_block"];

function offset(ms: number) {
  return `+${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Readable, ordered list of what one execution observed. Page text is rendered as plain text only. */
export function EvidenceTimeline({ events, emptyText = "Nothing recorded." }: { events: Event[]; emptyText?: string }) {
  if (events.length === 0) return <p className="text-sm text-on-surface-variant">{emptyText}</p>;
  return (
    // Gap-separated pill rows (no dividers): time, event, detail, severity chip.
    <ol className="flex flex-col gap-0.5">
      {events.map((event) => {
        const Icon = KIND_ICON[event.kind];
        const fault = event.kind === "fault_injected";
        const chip = fault ? { status: "resilient" as const, label: "Injected" } : SEVERITY_CHIP[event.severity];
        return (
          <li key={event.id} className="grid grid-cols-[3.75rem_1.25rem_1fr] gap-x-2 rounded-sm bg-surface-container px-3 py-3 first:rounded-t-lg last:rounded-b-lg sm:grid-cols-[4.25rem_1.25rem_1fr_auto] sm:px-4">
            <time dateTime={event.occurredAt.toISOString()} title={formatDateTime(event.occurredAt)} className="md-label-medium tabular pt-0.5 text-on-surface-variant">
              {offset(event.offsetMs)}
            </time>
            <Icon aria-hidden className={cn("mt-0.5 size-4", fault ? "text-fault" : SEVERITY_TEXT[event.severity])} />
            <div className="min-w-0">
              <p className={cn("md-title-medium", fault ? "text-fault" : "text-on-surface")}>{EVIDENCE_KIND_LABELS[event.kind]}</p>
              <p className="md-body-medium break-words whitespace-pre-wrap text-on-surface">{event.message}</p>
              {event.url ? (
                <p className="md-body-medium mt-0.5 break-all text-on-surface-variant">
                  {event.method && event.method !== "GET" ? `${event.method} ` : ""}
                  {event.url}
                  {event.resourceType ? <span className="ml-1.5">({event.resourceType})</span> : null}
                </p>
              ) : null}
            </div>
            <span className="col-start-3 mt-2 sm:col-start-auto sm:mt-0">
              <Chip status={chip.status} icon={null}>
                {chip.label}
              </Chip>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function problemEvents(events: Event[]) {
  return events.filter((e) => PROBLEM_KINDS.includes(e.kind) && e.severity !== "info");
}
