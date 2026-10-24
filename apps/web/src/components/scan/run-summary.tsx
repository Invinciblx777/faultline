import { EXECUTION_ROLE_LABELS, outcomeRendered } from "@faultline/shared";
import { OutcomeChip, ToneChip } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { ScanDetail } from "@/lib/data/queries";
import { formatDuration } from "@/lib/format";

type Execution = ScanDetail["executions"][number];

export const ROLE_STYLE = {
  baseline: { text: "text-normal", bg: "bg-normal", container: "bg-normal-container text-on-normal-container", border: "border-normal" },
  fault: { text: "text-fault", bg: "bg-fault", container: "bg-fault-container text-on-fault-container", border: "border-fault" },
} as const;

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "failure" | "neutral" }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className={cn("type-headline tabular text-2xl", tone === "failure" && Number(value) > 0 ? "text-failure" : "text-on-surface")}>{value}</dd>
    </div>
  );
}

/** Factual summary of one execution: outcome, page facts, and evidence counts. */
export function RunSummary({ execution }: { execution: Execution }) {
  const style = ROLE_STYLE[execution.role];
  const s = execution.summary;
  return (
    <article className={cn("flex flex-col gap-4 rounded-xl border-t-4 bg-surface-low p-5 sm:p-6", style.border)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={cn("type-headline text-xl", style.text)}>{EXECUTION_ROLE_LABELS[execution.role]}</h3>
        {execution.status === "completed" ? (
          <OutcomeChip outcome={execution.outcome} />
        ) : (
          <ToneChip tone={execution.status === "skipped" ? "unavailable" : "incomplete"} label={execution.status === "skipped" ? "Skipped" : execution.status === "failed" ? "Did not complete" : "Running"} />
        )}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-on-surface-variant">Title</dt>
        <dd className="break-words">{execution.pageTitle || <span className="text-on-surface-variant">None recorded</span>}</dd>
        <dt className="text-on-surface-variant">HTTP status</dt>
        <dd className="tabular">{execution.httpStatus ?? <span className="text-on-surface-variant">None</span>}</dd>
        <dt className="text-on-surface-variant">Final URL</dt>
        <dd className="break-all">{execution.finalUrl ?? <span className="text-on-surface-variant">None</span>}</dd>
        <dt className="text-on-surface-variant">Duration</dt>
        <dd className="tabular">{formatDuration(execution.durationMs)}</dd>
        {execution.navigationError ? (
          <>
            <dt className="text-on-surface-variant">Navigation error</dt>
            <dd className="break-words text-failure">{execution.navigationError}</dd>
          </>
        ) : null}
        {execution.failureMessage ? (
          <>
            <dt className="text-on-surface-variant">Note</dt>
            <dd className="text-incomplete">{execution.failureMessage}</dd>
          </>
        ) : null}
      </dl>
      {s ? (
        <dl className="grid grid-cols-3 gap-3 border-t border-outline-variant pt-4 sm:grid-cols-5">
          <Stat label="Requests" value={s.totalRequests} />
          <Stat label="Failed" value={s.failedRequests} tone="failure" />
          <Stat label="HTTP errors" value={s.httpErrors} tone="failure" />
          <Stat label="Console errors" value={s.consoleErrors + s.pageErrors} tone="failure" />
          <Stat label="Blocked on purpose" value={s.intentionallyBlocked} />
        </dl>
      ) : null}
      {execution.status === "completed" && !outcomeRendered(execution.outcome) && !execution.screenshot ? (
        <p className="text-sm text-on-surface-variant">No screenshot: the page did not render content to capture.</p>
      ) : null}
    </article>
  );
}
