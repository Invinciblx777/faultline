import { AlertTriangle, CheckSquare, CircleDot, FileWarning, Footprints, Navigation, ScrollText, ShieldAlert, Syringe, Unplug, type LucideIcon } from "lucide-react";
import type { EvidenceKind } from "@faultline/shared";
import type { ExperimentDetail } from "@/lib/data/analysis";
import { cn } from "@/lib/cn";

type Attempt = ExperimentDetail["attempts"][number];
type Event = Attempt["events"][number];

const ICON: Partial<Record<EvidenceKind, LucideIcon>> = {
  lifecycle: CircleDot,
  navigation: Navigation,
  console: ScrollText,
  page_error: AlertTriangle,
  request_failed: Unplug,
  http_error: FileWarning,
  fault_injected: Syringe,
  policy_block: ShieldAlert,
  journey_step: Footprints,
  assertion: CheckSquare,
};

const offset = (ms: number) => `+${(ms / 1000).toFixed(2)} s`;

function detailOf(event: Event) {
  return (event.detail ?? {}) as { requestId?: number | null; stepIndex?: number | null; consequenceOfFaultInjection?: boolean; status?: string };
}

/** Origin of an entry: injected by FAULTLINE, a safety block, or observed from the page. */
function sourceOf(event: Event): { label: string; className: string } {
  const d = detailOf(event);
  if (event.kind === "fault_injected") return { label: "Injected", className: "bg-fault-container text-on-fault-container" };
  if (event.kind === "policy_block") return { label: "Safety block", className: "bg-surface-highest text-on-surface-variant" };
  if (event.kind === "journey_step" || event.kind === "assertion") return { label: "Journey", className: "bg-primary-container text-on-primary-container" };
  if (d.consequenceOfFaultInjection) return { label: "Fault side effect", className: "border border-dashed border-fault text-fault" };
  return { label: "Observed", className: "bg-surface-highest text-on-surface" };
}

/**
 * Ordered evidence from one experiment run, with the injected fault, the
 * page's reactions, and the journey's checks on one clock. It shows order in
 * time, which is consistent with cause and effect but does not prove it; the
 * verdict comes from comparing the same checks against the baseline runs.
 */
export function CausalTimeline({ attempt }: { attempt: Attempt }) {
  const events = attempt.events.filter((e) => !(e.kind === "navigation" && e.severity === "info" && e.message.startsWith("Redirected")) && e.kind !== "screenshot");
  const firstInjected = events.find((e) => e.kind === "fault_injected");
  const firstFailure = events.find((e) => (e.kind === "assertion" || e.kind === "journey_step") && e.severity === "error");
  const between = firstInjected && firstFailure ? events.filter((e) => e.seq > firstInjected.seq && e.seq < firstFailure.seq && e.severity !== "info" && e.kind !== "fault_injected") : [];

  return (
    <div>
      {firstInjected ? (
        <div className="mb-5 rounded-lg border-l-4 border-fault bg-surface-low p-4 text-sm">
          <p className="type-title mb-2">Sequence</p>
          <ol className="flex flex-col gap-1.5">
            <li>
              <span className="tabular text-on-surface-variant">{offset(firstInjected.offsetMs)}</span> FAULTLINE applied the fault: {firstInjected.message}
              {detailOf(firstInjected).requestId != null ? (
                <a className="ml-1 text-primary underline-offset-4 hover:underline" href={`#req-${attempt.id}-${detailOf(firstInjected).requestId}`}>
                  request #{detailOf(firstInjected).requestId}
                </a>
              ) : null}
            </li>
            {between.slice(0, 4).map((e) => (
              <li key={e.seq}>
                <span className="tabular text-on-surface-variant">{offset(e.offsetMs)}</span> The page reported: {e.message}
              </li>
            ))}
            {firstFailure ? (
              <li>
                <span className="tabular text-on-surface-variant">{offset(firstFailure.offsetMs)}</span> First failed check:{" "}
                <a className="text-primary underline-offset-4 hover:underline" href={`#step-${detailOf(firstFailure).stepIndex ?? ""}`}>
                  {firstFailure.message}
                </a>
              </li>
            ) : (
              <li className="text-on-surface-variant">No journey check failed in this run.</li>
            )}
          </ol>
          <p className="mt-2 text-xs text-on-surface-variant">
            Ordered in time. Order alone does not prove cause; the verdict compares the same checks against two normal runs in which they passed.
          </p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-on-surface-variant">No fault was applied in this run, so there is no sequence to show.</p>
      )}

      <ol className="flex flex-col">
        {events.map((e) => {
          const Icon = ICON[e.kind] ?? CircleDot;
          const source = sourceOf(e);
          const d = detailOf(e);
          return (
            <li key={e.seq} className="flex gap-3 border-l-2 border-outline-variant py-2 pl-4">
              <span className="tabular w-16 shrink-0 pt-0.5 text-xs text-on-surface-variant">{offset(e.offsetMs)}</span>
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", e.severity === "error" ? "text-failure" : e.severity === "warning" ? "text-incomplete" : "text-on-surface-variant")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words">
                  <span className={cn("type-label mr-2 inline-flex rounded-sm px-1.5 text-xs", source.className)}>{source.label}</span>
                  {e.message}
                </p>
                {e.url || d.requestId != null || d.stepIndex != null ? (
                  <p className="text-xs break-all text-on-surface-variant">
                    {e.method ? `${e.method} ` : ""}
                    {e.url ?? ""}
                    {e.statusCode ? ` · HTTP ${e.statusCode}` : ""}
                    {d.requestId != null ? (
                      <a className="ml-2 text-primary underline-offset-4 hover:underline" href={`#req-${attempt.id}-${d.requestId}`}>
                        request #{d.requestId}
                      </a>
                    ) : null}
                    {d.stepIndex != null ? (
                      <a className="ml-2 text-primary underline-offset-4 hover:underline" href={`#step-${d.stepIndex}`}>
                        step {d.stepIndex + 1}
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

