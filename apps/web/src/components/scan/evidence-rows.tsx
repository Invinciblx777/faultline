import { EVIDENCE_KIND_LABELS } from "@faultline/shared";
import { Chip, ListGroup, ListItem, type ChipStatus } from "@/design/components";
import type { ScanDetail } from "@/lib/data/queries";

type Event = ScanDetail["executions"][number]["events"][number];

export const NETWORK_KINDS = ["request_failed", "http_error", "fault_injected", "policy_block"] as const;
export const CONSOLE_KINDS = ["console", "page_error"] as const;

const NETWORK_CHIP: Record<(typeof NETWORK_KINDS)[number], ChipStatus> = {
  request_failed: "broken",
  http_error: "degraded",
  fault_injected: "resilient",
  policy_block: "inconclusive",
};

const LEVEL_CHIP: Record<Event["severity"], { status: ChipStatus; label: string }> = {
  info: { status: "neutral", label: "Info" },
  warning: { status: "degraded", label: "Warning" },
  error: { status: "broken", label: "Error" },
};

/** Keeps both ends of a long URL visible: origin and path head, then the tail. */
export function truncateMiddle(value: string, max = 72) {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.6);
  return `${value.slice(0, head)}…${value.slice(value.length - (max - 1 - head))}`;
}

function offset(ms: number) {
  return `+${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function NetworkRows({ events, emptyText }: { events: Event[]; emptyText: string }) {
  const rows = events.filter((e) => (NETWORK_KINDS as readonly string[]).includes(e.kind));
  if (!rows.length) return <p className="md-body-medium text-on-surface-variant">{emptyText}</p>;
  return (
    <ListGroup>
      {rows.map((e) => (
        <ListItem
          key={e.id}
          leading={<span className="md-label-medium inline-block w-14 font-mono text-on-surface-variant">{e.method ?? "GET"}</span>}
          headline={
            <span className="block truncate font-mono text-sm" title={e.url ?? undefined}>
              {e.url ? truncateMiddle(e.url) : EVIDENCE_KIND_LABELS[e.kind]}
            </span>
          }
          supporting={e.message}
          trailing={
            <span className="flex flex-col items-end gap-1">
              <Chip status={NETWORK_CHIP[e.kind as (typeof NETWORK_KINDS)[number]]} icon={null}>
                {EVIDENCE_KIND_LABELS[e.kind]}
              </Chip>
              <span className="md-label-medium tabular text-on-surface-variant">{offset(e.offsetMs)}</span>
            </span>
          }
        />
      ))}
    </ListGroup>
  );
}

export function ConsoleRows({ events, emptyText }: { events: Event[]; emptyText: string }) {
  const rows = events.filter((e) => (CONSOLE_KINDS as readonly string[]).includes(e.kind));
  if (!rows.length) return <p className="md-body-medium text-on-surface-variant">{emptyText}</p>;
  return (
    <ListGroup>
      {rows.map((e) => (
        <ListItem
          key={e.id}
          leading={
            <Chip status={LEVEL_CHIP[e.severity].status} icon={null}>
              {e.kind === "page_error" ? "Exception" : LEVEL_CHIP[e.severity].label}
            </Chip>
          }
          headline={<span className="block font-mono text-sm break-words whitespace-pre-wrap">{e.message}</span>}
          supporting={e.url ? truncateMiddle(e.url) : undefined}
          trailing={<span className="md-label-medium tabular text-on-surface-variant">{offset(e.offsetMs)}</span>}
        />
      ))}
    </ListGroup>
  );
}
