import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { describeScenario, EXECUTION_ROLE_LABELS, SCENARIO_LABELS, VERDICTS, type ExecutionRole } from "@faultline/shared";
import { VerdictChip } from "@/components/analysis/verdict";
import { OutcomeChip, ScanStatusChip } from "@/components/ui/status";
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

export function ScanList({ scans, showProject = false }: { scans: ScanListItem[]; showProject?: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {scans.map((scan) => (
        <li key={scan.id}>
          <Link
            href={scan.scenarioKind === "blast-radius" ? `/scans/${scan.id}/blast-radius` : `/scans/${scan.id}`}
            className="group flex flex-col gap-3 rounded-lg bg-surface-low px-5 py-4 transition-colors hover:bg-surface-container sm:flex-row sm:items-center sm:gap-6"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="type-title">{SCENARIO_LABELS[scan.scenarioKind]}</span>
                <span className="text-sm text-on-surface-variant">{describeScenario(scan.scenarioConfig)}</span>
              </div>
              <span className="truncate text-sm text-on-surface-variant">
                {showProject ? <span className="text-on-surface">{scan.projectName} · </span> : null}
                {hostOf(scan.targetUrl)}
              </span>
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
              <div className="text-sm text-on-surface-variant sm:text-right">
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
    </ul>
  );
}
