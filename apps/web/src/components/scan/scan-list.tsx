import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { describeScenario, EXECUTION_ROLE_LABELS, SCENARIO_LABELS, VERDICTS, type ExecutionRole } from "@faultline/shared";
import { VerdictChip } from "@/components/analysis/verdict";
import { OutcomeChip, ScanStatusChip } from "@/design/components/status";
import { ListGroup, SegmentedProgress, type SegmentState } from "@/design/components";
import type { ScanListItem } from "@/lib/data/queries";
import { formatDateTime, formatDuration, formatRelative, hostOf } from "@/lib/format";

function RunOutcome({ scan, role }: { scan: ScanListItem; role: ExecutionRole }) {
  const execution = scan.executions.find((e) => e.role === role);
  if (!execution || execution.status === "pending" || execution.status === "running") return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${role === "baseline" ? "bg-normal" : "bg-fault"}`} aria-hidden />
      <span className="sr-only">{EXECUTION_ROLE_LABELS[role]}:</span>
      <OutcomeChip outcome={execution.outcome} className="h-6 text-xs" />
    </span>
  );
}

/** Queued → running → completed as three gapped segments; failures and cancellations mark the segment they stopped in. */
function phases(status: ScanListItem["status"]): Array<{ label: string; state: SegmentState }> {
  const states: Record<string, [SegmentState, SegmentState, SegmentState]> = {
    queued: ["active", "pending", "pending"],
    running: ["done", "active", "pending"],
    completed: ["done", "done", "done"],
    failed: ["done", "done", "failed"],
    cancelled: ["done", "failed", "pending"],
  };
  const [q, r, c] = states[status] ?? ["done", "active", "pending"];
  return [
    { label: "Queued", state: q },
    { label: "Running", state: r },
    { label: "Completed", state: c },
  ];
}

export function ScanList({ scans, showProject = false }: { scans: ScanListItem[]; showProject?: boolean }) {
  return (
    <ListGroup>
      {scans.map((scan) => (
        <li key={scan.id} className="overflow-hidden">
          <Link
            href={scan.scenarioKind === "blast-radius" ? `/scans/${scan.id}/blast-radius` : `/scans/${scan.id}`}
            className="group flex flex-col gap-3 bg-surface-container px-5 py-4 transition-colors hover:bg-surface-high sm:flex-row sm:items-center sm:gap-6"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="md-title-medium">{SCENARIO_LABELS[scan.scenarioKind]}</span>
                <span className="md-body-medium text-on-surface-variant">{describeScenario(scan.scenarioConfig)}</span>
              </div>
              <span className="md-body-medium truncate text-on-surface-variant">
                {showProject ? <span className="text-on-surface">{scan.projectName} · </span> : null}
                {hostOf(scan.targetUrl)}
              </span>
              <SegmentedProgress label="Scan phases" segments={phases(scan.status)} className="max-w-64 pt-1" />
              <div className="flex flex-wrap gap-2 pt-1">
                {scan.scenarioKind === "blast-radius" ? (
                  VERDICTS.filter((v) => scan.verdicts[v]).map((v) => (
                    <span key={v} className="inline-flex items-center gap-1">
                      <VerdictChip verdict={v} size="sm" />
                      <span className="tabular text-sm">×{scan.verdicts[v]}</span>
                    </span>
                  ))
                ) : (
                  <>
                    <RunOutcome scan={scan} role="baseline" />
                    <RunOutcome scan={scan} role="fault" />
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 sm:justify-end">
              <div className="md-label-medium text-on-surface-variant sm:text-right">
                <time dateTime={scan.createdAt.toISOString()} title={formatDateTime(scan.createdAt)} className="block">
                  {formatRelative(scan.createdAt)}
                </time>
                <span className="tabular block">{formatDuration(scan.durationMs)}</span>
              </div>
              <ScanStatusChip status={scan.status} />
              <ChevronRight aria-hidden className="ml-auto size-5 text-on-surface-variant transition-transform group-hover:translate-x-0.5 sm:ml-0" />
            </div>
          </Link>
        </li>
      ))}
    </ListGroup>
  );
}
