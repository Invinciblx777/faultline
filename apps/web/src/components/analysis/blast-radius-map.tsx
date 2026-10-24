"use client";

import { ArrowRight, CheckSquare, Download, Footprints } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { VERDICT_DEFINITIONS, VERDICT_LABELS, VERDICTS, type ExperimentKind, type Reproducibility, type Verdict } from "@faultline/shared";
import type { ExperimentStatus } from "@faultline/db";
import { ExperimentStateChip, KindLabel, VERDICT_STYLE } from "@/components/analysis/verdict";
import { BottomSheet, SegmentedProgress, type SegmentState } from "@/design/components";
import { cn } from "@/lib/cn";

export interface MapStep {
  index: number;
  description: string;
  isAssertion: boolean;
  /** Passed in both normal runs, so it can support a verdict. */
  stable: boolean;
  excludedReason: string | null;
}

export interface MapExperiment {
  id: string;
  ordinal: number;
  kind: ExperimentKind;
  title: string;
  /** Plain-language observation about the dependency itself, e.g. a development endpoint shipped to production. */
  note: string | null;
  party: "first-party" | "third-party" | null;
  status: ExperimentStatus;
  verdict: Verdict | null;
  reproducibility: Reproducibility | null;
  reasons: Array<{ code: string; message: string; stepIndex?: number }>;
  affectedSteps: number[];
  /** Steps during which the browser requested this dependency in the baseline run. */
  requestedDuringSteps: number[];
  affectedRequestCount: number;
  test: { status: string } | null;
}

// Step pill tint for the selected experiment's verdict. Color is paired with a text label in each pill.
const STEP_HIT: Partial<Record<Verdict, string>> = {
  broken: "bg-error-container text-on-error-container",
  degraded: "bg-tertiary-container text-on-tertiary-container",
};

/**
 * Journey-step strip above a responsive grid of experiments (a dependency under one fault, or a
 * condition). Selecting a tile tints the steps it broke or degraded in the strip and outlines the
 * steps during which the browser requested that dependency in the baseline run.
 */
export function BlastRadiusMap({ scanId, steps, experiments }: { scanId: string; steps: MapStep[]; experiments: MapExperiment[] }) {
  const [filter, setFilter] = useState<Set<Verdict>>(() => new Set(VERDICTS));
  const [party, setParty] = useState<"all" | "first-party" | "third-party">("all");
  const [showUsage, setShowUsage] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const e of experiments) if (e.verdict) c[e.verdict] = (c[e.verdict] ?? 0) + 1;
    return c;
  }, [experiments]);

  const visible = useMemo(
    () => experiments.filter((e) => (e.verdict ? filter.has(e.verdict) : true) && (party === "all" || e.party === party)),
    [experiments, filter, party],
  );
  const active = selected ? (experiments.find((e) => e.id === selected) ?? null) : null;
  const highlighted = new Set(active ? [...active.affectedSteps] : []);
  const usageHighlighted = new Set(active ? active.requestedDuringSteps : []);

  const hitVerdict = active?.verdict === "broken" || active?.verdict === "degraded" ? active.verdict : null;
  const progress = steps.map((s): { label: string; state: SegmentState } => ({
    label: `Step ${s.index + 1}`,
    state: hitVerdict && highlighted.has(s.index) ? "failed" : !s.stable ? "pending" : "done",
  }));

  const toggle = (v: Verdict) => {
    const next = new Set(filter);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setFilter(next);
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by verdict">
          {VERDICTS.map((v) => {
            const style = VERDICT_STYLE[v];
            const Icon = style.icon;
            const on = filter.has(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(v)}
                title={VERDICT_DEFINITIONS[v]}
                className={cn(
                  "md-label-medium inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 transition-[opacity,border-radius] duration-200 active:rounded-lg",
                  on ? style.chip : "border border-outline-variant text-on-surface-variant opacity-60",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {VERDICT_LABELS[v]}
                <span className="tabular">{counts[v] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <span className="text-on-surface-variant">Origin</span>
            <select value={party} onChange={(e) => setParty(e.target.value as typeof party)} className="h-10 rounded-full bg-surface-high px-4">
              <option value="all">All</option>
              <option value="first-party">First-party</option>
              <option value="third-party">Third-party</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={showUsage} onChange={(e) => setShowUsage(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Show where each dependency is requested
          </label>
        </div>
      </div>

      <section aria-labelledby="journey-strip-title" className="mb-6">
        <h3 id="journey-strip-title" className="md-label-medium mb-2 text-on-surface-variant">
          Journey steps ({steps.length})
        </h3>
        {/* Scrolls horizontally on phones; wraps into rows on wide screens. */}
        <ol className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {steps.map((s) => {
            const hit = Boolean(hitVerdict) && highlighted.has(s.index);
            const used = !hit && usageHighlighted.has(s.index) && showUsage;
            const Icon = s.isAssertion ? CheckSquare : Footprints;
            return (
              <li
                key={s.index}
                title={`${s.description}${!s.stable ? ` (excluded: ${s.excludedReason})` : ""}`}
                className={cn(
                  "md-label-medium flex h-10 max-w-64 shrink-0 items-center gap-2 rounded-full px-3 transition-[background-color,color] duration-200",
                  hit && hitVerdict ? STEP_HIT[hitVerdict] : "bg-surface-container text-on-surface",
                  used && "ring-2 ring-outline ring-inset",
                  !s.stable && "border border-dashed border-outline-variant text-on-surface-variant",
                )}
              >
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-surface-highest text-on-surface">{s.index + 1}</span>
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{s.description}</span>
                {hit ? <span className="sr-only">{hitVerdict === "broken" ? "failed or not reached" : "expectation violated"}</span> : null}
              </li>
            );
          })}
        </ol>
        <SegmentedProgress label="Journey steps under the selected experiment" segments={progress} className="mt-3" />
      </section>

      <h3 className="md-label-medium mb-2 text-on-surface-variant">Faults and conditions ({visible.length})</h3>
      {visible.length === 0 ? <p className="md-body-medium text-on-surface-variant">No experiments match these filters.</p> : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {visible.map((e, i) => {
          const style = e.verdict ? VERDICT_STYLE[e.verdict] : null;
          return (
            // Staggered entrance: 30ms per tile, capped at 300ms.
            <li key={e.id} className="md-enter" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <button
                type="button"
                onClick={() => setSelected(selected === e.id ? null : e.id)}
                aria-pressed={selected === e.id}
                aria-label={`${e.title}: ${e.verdict ? VERDICT_LABELS[e.verdict] : e.status}. ${e.affectedSteps.length ? `Affects steps ${e.affectedSteps.map((s) => s + 1).join(", ")}.` : ""} Show details.`}
                className={cn(
                  "relative flex h-full min-h-12 w-full flex-col gap-1.5 rounded-lg px-4 py-3.5 text-left transition-[filter,border-radius] duration-200 hover:brightness-110 active:rounded-xl",
                  style ? style.tile : "bg-surface-high text-on-surface",
                  selected === e.id && "ring-3 ring-secondary",
                )}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <KindLabel kind={e.kind} className="md-label-medium opacity-80" />
                  <ExperimentStateChip status={e.status} verdict={e.verdict} />
                </span>
                <span className="md-title-medium break-all">{e.title}</span>
                {e.note ? <span className="md-body-medium">{e.note}</span> : null}
                {e.affectedSteps.length && (e.verdict === "broken" || e.verdict === "degraded") ? (
                  <span className="md-label-medium opacity-80">Steps {e.affectedSteps.map((s) => s + 1).join(", ")}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 md-label-medium text-on-surface-variant">
        Select an experiment to tint the steps it affects: error tone for steps that failed or were never reached (BROKEN), tertiary for steps that held but
        exceeded a budget (DEGRADED). Outlined steps are where the dependency was requested in the baseline run.
      </p>

      <BottomSheet open={Boolean(active)} onClose={() => setSelected(null)} label="Experiment details" role="complementary">
        {active ? (
          <>
            <div className="mb-3 min-w-0 pr-12">
              <KindLabel kind={active.kind} className="md-label-medium text-on-surface-variant" />
              <h3 className="md-title-large mt-1 break-all">{active.title}</h3>
              {active.note ? <p className="md-body-medium mt-2 rounded-md bg-tertiary-container px-3 py-2 text-on-tertiary-container">{active.note}</p> : null}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ExperimentStateChip status={active.status} verdict={active.verdict} />
              {active.reproducibility && active.reproducibility !== "not-applicable" ? (
                <span className="md-body-medium text-on-surface-variant">
                  {active.reproducibility === "reproduced"
                    ? "Reproduced in a second run"
                    : active.reproducibility === "single-run"
                      ? "Single run"
                      : "Did not reproduce"}
                </span>
              ) : null}
            </div>
            {active.verdict ? <p className="md-body-medium mb-3 text-on-surface-variant">{VERDICT_DEFINITIONS[active.verdict]}</p> : null}
            {active.reasons.length ? (
              <ul className="mb-4 flex flex-col gap-0.5">
                {active.reasons.map((r, i) => (
                  <li key={i} className="md-body-medium bg-surface-container px-4 py-3 first:rounded-t-lg last:rounded-b-lg">
                    {r.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {active.affectedSteps.length && (active.verdict === "broken" || active.verdict === "degraded") ? (
              <div className="mb-4">
                <h4 className="md-label-medium mb-2 text-on-surface-variant">Affected steps</h4>
                <ol className="flex flex-col gap-0.5">
                  {active.affectedSteps.map((index) => {
                    const step = steps.find((s) => s.index === index);
                    return (
                      <li
                        key={index}
                        className={cn("md-body-medium flex gap-3 rounded-sm px-4 py-3 first:rounded-t-lg last:rounded-b-lg", STEP_HIT[active.verdict!])}
                      >
                        <span className="tabular font-medium">{index + 1}</span>
                        <span className="min-w-0 break-words">{step?.description ?? `Step ${index + 1}`}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
            {active.kind !== "offline" && active.kind !== "narrow-viewport" ? (
              <p className="md-body-medium mb-4 text-on-surface-variant">
                The fault acted on {active.affectedRequestCount} request{active.affectedRequestCount === 1 ? "" : "s"} in the first run.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/scans/${scanId}/experiments/${active.id}`}
                className="md-title-medium inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-6 text-on-secondary-container transition-[filter] hover:brightness-110"
              >
                Evidence and Reality Split <ArrowRight aria-hidden className="size-5" />
              </Link>
              {active.test ? (
                <a
                  href={`/api/experiments/${active.id}/regression-test`}
                  download
                  className="md-title-medium inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-6 text-on-secondary-container transition-[filter] hover:brightness-110"
                >
                  <Download aria-hidden className="size-5" /> Export test
                </a>
              ) : null}
            </div>
          </>
        ) : null}
      </BottomSheet>
    </div>
  );
}
