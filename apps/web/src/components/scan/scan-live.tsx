"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EXECUTION_OUTCOME_LABELS, isTerminalScanStatus, type ExecutionOutcome, type ExecutionRole, type ExecutionStatus, type ScanStatus } from "@faultline/shared";
import { ScanStatusChip } from "@/design/components/status";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

interface LiveStatus {
  status: ScanStatus;
  phase: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  executions: Array<{ role: ExecutionRole; status: ExecutionStatus; outcome: ExecutionOutcome | null; durationMs: number | null }>;
}

const STEPS: Array<{ role: ExecutionRole; label: string; tone: string; dot: string }> = [
  { role: "baseline", label: "Normal conditions", tone: "text-normal", dot: "bg-normal" },
  { role: "fault", label: "Fault conditions", tone: "text-fault", dot: "bg-fault" },
];

/**
 * Polls the scan status while it is queued or running. Every value shown here
 * comes from the database row the worker updates; nothing is simulated.
 */
export function ScanLive({ scanId, initial }: { scanId: string; initial: LiveStatus }) {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [connectionError, setConnectionError] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    if (isTerminalScanStatus(live.status)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as LiveStatus;
        if (cancelled) return;
        setConnectionError(false);
        setLive(next);
        if (isTerminalScanStatus(next.status) && !refreshed.current) {
          refreshed.current = true;
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
  }, [scanId, live.status, router]);

  const elapsed = live.startedAt ? now - new Date(live.startedAt).getTime() : null;

  return (
    <section aria-labelledby="progress-title" className="rounded-xl bg-surface-low p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="progress-title" className="type-title text-lg">
          {live.status === "queued" ? "Waiting for a worker" : "Scan in progress"}
        </h2>
        <ScanStatusChip status={live.status} />
      </div>
      <p className="mt-1 min-h-6 text-sm text-on-surface-variant" aria-live="polite">
        {live.cancelRequestedAt ? "Cancellation requested. The worker will stop at the next checkpoint." : (live.phase ?? (live.status === "queued" ? "Queued. A worker picks up scans in the order they were created." : ""))}
        {elapsed !== null && live.status === "running" ? <span className="tabular"> · {formatDuration(Math.max(0, elapsed))} elapsed</span> : null}
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const execution = live.executions.find((e) => e.role === step.role);
          const state = execution?.status ?? "pending";
          return (
            <li
              key={step.role}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors duration-300",
                state === "running" ? "border-primary bg-surface-container" : "border-outline-variant",
              )}
            >
              <span className={cn("size-3 rounded-full", step.dot, state === "running" && "running-pulse", state === "pending" && "opacity-30")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={cn("type-title block", step.tone)}>{step.label}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={state + (execution?.outcome ?? "")}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                    className="block text-sm text-on-surface-variant"
                  >
                    {state === "pending" && "Not started"}
                    {state === "running" && "Running in Chromium"}
                    {state === "completed" && (execution?.outcome ? `${EXECUTION_OUTCOME_LABELS[execution.outcome]} · ${formatDuration(execution.durationMs)}` : "Completed")}
                    {state === "failed" && "Did not complete"}
                    {state === "skipped" && "Skipped"}
                  </motion.span>
                </AnimatePresence>
              </span>
            </li>
          );
        })}
      </ol>
      {connectionError ? <p className="mt-3 text-sm text-incomplete">Lost contact with the server. Retrying…</p> : null}
    </section>
  );
}
