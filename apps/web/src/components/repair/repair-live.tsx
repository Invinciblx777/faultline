"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RepairStatus } from "@faultline/shared";
import { formatRelative } from "@/lib/format";

interface LiveStatus {
  status: RepairStatus;
  updatedAt: string;
  lastSyncedAt: string | null;
  syncError: string | null;
  events: number;
  verification: { status: string; phase: string | null; checks: number } | null;
}

/** Statuses in which something may change without the operator doing anything. */
const MOVING: RepairStatus[] = ["queued", "submitting", "devin_running", "devin_finished_no_pr", "ready_for_verification", "verifying"];

/**
 * Reads FAULTLINE's stored repair state every few seconds and refreshes the
 * page when it changes. It never contacts Devin; the worker does that on its
 * own schedule, shown here as "last synced".
 */
export function RepairLive({ repairId, initial, pollIntervalMs }: { repairId: string; initial: LiveStatus; pollIntervalMs: number }) {
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const [lost, setLost] = useState(false);
  const [, setTick] = useState(0);
  const signature = useRef(JSON.stringify([initial.status, initial.updatedAt, initial.events, initial.verification]));

  useEffect(() => {
    if (!MOVING.includes(live.status)) return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/repairs/${repairId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as LiveStatus;
        if (cancelled) return;
        setLost(false);
        setLive(next);
        const sig = JSON.stringify([next.status, next.updatedAt, next.events, next.verification]);
        if (sig !== signature.current) {
          signature.current = sig;
          router.refresh();
        }
      } catch {
        if (!cancelled) setLost(true);
      }
    }, 3000);
    const clock = setInterval(() => setTick((t) => t + 1), 5000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [repairId, live.status, router]);

  if (!MOVING.includes(live.status)) return null;
  return (
    <p className="text-xs text-on-surface-variant" aria-live="polite">
      {live.verification && (live.verification.status === "queued" || live.verification.status === "running")
        ? `Verification ${live.verification.status}${live.verification.phase ? `: ${live.verification.phase}` : ""} · ${live.verification.checks} checks recorded`
        : live.lastSyncedAt
          ? `Worker last synced with Devin and GitHub ${formatRelative(live.lastSyncedAt)} (every ${Math.round(pollIntervalMs / 1000)} s).`
          : live.status === "queued" || live.status === "submitting"
            ? "Waiting for the worker to create the session."
            : "Waiting for the worker's first sync."}
      {live.syncError ? <span className="text-failure"> Last sync failed: {live.syncError}</span> : null}
      {lost ? <span className="text-incomplete"> Lost contact with the FAULTLINE server; retrying.</span> : null}
      <span className="sr-only"> This page re-reads stored state every 3 seconds.</span>
    </p>
  );
}
