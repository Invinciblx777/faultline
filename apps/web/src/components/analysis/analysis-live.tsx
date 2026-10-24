"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isTerminalScanStatus, type ExecutionStatus, type ExperimentKind, type ScanStatus, type Verdict } from "@faultline/shared";
import type { ExperimentStatus } from "@faultline/db";
import { ExperimentStateChip, KindLabel } from "@/components/analysis/verdict";
import { ScanStatusChip } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

export interface AnalysisLiveStatus {
  status: ScanStatus;
  phase: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  executions: Array<{ role: string; status: ExecutionStatus; attempt: number; experimentId: string | null }>;
  experiments: Array<{ id: string; ordinal: number; kind: ExperimentKind; dependencyLabel: string | null; status: ExperimentStatus; verdict: Verdict | null }>;
}

/** Polls stored analysis state while it is queued or running. Nothing here is simulated. */
export function AnalysisLive({ scanId, initial }: { scanId: string; initial: AnalysisLiveStatus }) {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [connectionError, setConnectionError] = useState(false);
  const refreshed = useRef(false);
  const seen = useRef(initial.experiments.filter((e) => e.verdict).length);

  useEffect(() => {
    if (isTerminalScanStatus(live.status)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}/analysis`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as AnalysisLiveStatus;
        if (cancelled) return;
        setConnectionError(false);
        setLive(next);
        const decided = next.experiments.filter((e) => e.verdict).length;
        // Refresh server-rendered sections when the plan appears, a verdict lands, or the analysis ends.
        if ((next.experiments.length && !live.experiments.length) || decided !== seen.current || (isTerminalScanStatus(next.status) && !refreshed.current)) {
          seen.current = decided;
          if (isTerminalScanStatus(next.status)) refreshed.current = true;
          router.refresh();
        }
      } catch {
        if (!cancelled) setConnectionError(true);
      }
    };
    const poll = setInterval(tick, 1500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [scanId, live.status, live.experiments.length, router]);

  const elapsed = live.startedAt ? now - new Date(live.startedAt).getTime() : null;
  const normal = (role: string) => live.executions.find((e) => e.role === role)?.status ?? "pending";

  return (
    <section aria-labelledby="progress-title" className="rounded-xl bg-surface-low p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="progress-title" className="type-title text-lg">
          {live.status === "queued" ? "Waiting for a worker" : "Analysis in progress"}
        </h2>
        <ScanStatusChip status={live.status} />
      </div>
      <p className="mt-1 min-h-6 text-sm text-on-surface-variant" aria-live="polite">
        {live.cancelRequestedAt ? "Cancellation requested. The worker stops at the next checkpoint." : (live.phase ?? (live.status === "queued" ? "Queued." : ""))}
        {elapsed !== null && live.status === "running" ? <span className="tabular"> · {formatDuration(Math.max(0, elapsed))} elapsed</span> : null}
      </p>
      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {[
          { role: "baseline", label: "Baseline run" },
          { role: "calibration", label: "Calibration run" },
        ].map(({ role, label }) => {
          const state = normal(role);
          return (
            <li key={role} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", state === "running" ? "border-primary bg-surface-container" : "border-outline-variant")}>
              <span className={cn("size-3 rounded-full bg-normal", state === "running" && "running-pulse", state === "pending" && "opacity-30")} aria-hidden />
              <span className="type-title text-normal">{label}</span>
              <span className="ml-auto text-sm text-on-surface-variant">
                {state === "pending" ? "Not started" : state === "running" ? "Running in Chromium" : state === "completed" ? "Done" : state === "failed" ? "Did not complete" : "Skipped"}
              </span>
            </li>
          );
        })}
      </ol>
      {live.experiments.length ? (
        <ol className="mt-4 flex flex-col gap-2" aria-label="Experiments">
          {live.experiments.map((e) => (
            <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3", e.status === "running" ? "border-primary bg-surface-container" : "border-outline-variant")}>
              <span className="tabular text-sm text-on-surface-variant">{e.ordinal}.</span>
              <KindLabel kind={e.kind} className="text-sm" />
              <span className="min-w-0 flex-1 truncate text-sm">{e.dependencyLabel ?? ""}</span>
              <ExperimentStateChip status={e.status} verdict={e.verdict} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-on-surface-variant">Experiments are planned after both normal runs, from the dependencies they actually used.</p>
      )}
      {connectionError ? <p className="mt-3 text-sm text-incomplete">Lost contact with the server. Retrying…</p> : null}
    </section>
  );
}
