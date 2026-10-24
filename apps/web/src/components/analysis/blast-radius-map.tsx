"use client";

import { ArrowRight, CheckSquare, Download, Footprints } from "lucide-react";
import Link from "next/link";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VERDICT_DEFINITIONS, VERDICT_LABELS, VERDICTS, type ExperimentKind, type Reproducibility, type Verdict } from "@faultline/shared";
import type { ExperimentStatus } from "@faultline/db";
import { ExperimentStateChip, KindLabel, VERDICT_STYLE } from "@/components/analysis/verdict";
import { BottomSheet } from "@/design/components";
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

const STROKE: Record<Verdict, string> = {
  broken: "var(--failure)",
  degraded: "var(--tertiary)",
  resilient: "var(--secondary)",
  inconclusive: "var(--unavailable)",
  test_failed: "var(--unavailable)",
};
const DASH: Record<Verdict, string | undefined> = { broken: undefined, degraded: "7 5", resilient: undefined, inconclusive: "2 5", test_failed: "2 5" };

interface Line {
  key: string;
  d: string;
  verdict: Verdict | null;
  kind: "impact" | "usage";
  experimentId: string;
}

/**
 * Bipartite map: experiments (a dependency under one fault, or a condition)
 * on the left, journey steps on the right. Thick verdict-colored links show
 * the steps an experiment broke or degraded; thin gray links show where the
 * browser requested that dependency during the baseline run.
 */
export function BlastRadiusMap({ scanId, steps, experiments }: { scanId: string; steps: MapStep[]; experiments: MapExperiment[] }) {
  const [filter, setFilter] = useState<Set<Verdict>>(() => new Set(VERDICTS));
  const [party, setParty] = useState<"all" | "first-party" | "third-party">("all");
  const [showUsage, setShowUsage] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const left = useRef(new Map<string, HTMLElement>());
  const right = useRef(new Map<number, HTMLElement>());

  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const e of experiments) if (e.verdict) c[e.verdict] = (c[e.verdict] ?? 0) + 1;
    return c;
  }, [experiments]);

  const visible = useMemo(
    () => experiments.filter((e) => (e.verdict ? filter.has(e.verdict) : true) && (party === "all" || e.party === party)),
    [experiments, filter, party],
  );
  const active = selected ? experiments.find((e) => e.id === selected) ?? null : null;
  const highlighted = new Set(active ? [...active.affectedSteps] : []);
  const usageHighlighted = new Set(active ? active.requestedDuringSteps : []);

  const measure = useCallback(() => {
    const root = frame.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
    // Side-by-side columns only; on narrow screens the columns stack and links are omitted.
    const anyLeft = [...left.current.values()][0];
    const anyRight = [...right.current.values()][0];
    if (!anyLeft || !anyRight || anyRight.getBoundingClientRect().left <= anyLeft.getBoundingClientRect().right) {
      setLines([]);
      return;
    }
    const next: Line[] = [];
    for (const e of visible) {
      const from = left.current.get(e.id)?.getBoundingClientRect();
      if (!from) continue;
      const x1 = from.right - rect.left;
      const y1 = from.top + from.height / 2 - rect.top;
      const link = (step: number, kind: Line["kind"]) => {
        const to = right.current.get(step)?.getBoundingClientRect();
        if (!to) return;
        const x2 = to.left - rect.left;
        const y2 = to.top + to.height / 2 - rect.top;
        const mid = (x1 + x2) / 2;
        next.push({ key: `${e.id}-${kind}-${step}`, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, verdict: e.verdict, kind, experimentId: e.id });
      };
      if (showUsage) for (const s of e.requestedDuringSteps) link(s, "usage");
      if (e.verdict === "broken" || e.verdict === "degraded") for (const s of e.affectedSteps) link(s, "impact");
    }
    setLines(next);
  }, [visible, showUsage]);

  useLayoutEffect(() => {
    measure();
    const root = frame.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

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
                className={cn("md-label-medium inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 transition-[opacity,border-radius] duration-200 active:rounded-lg", on ? style.chip : "border border-outline-variant text-on-surface-variant opacity-60")}
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

      <div ref={frame} className="relative grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-x-24">
        <svg className="pointer-events-none absolute inset-0 hidden md:block" width={box.width} height={box.height} aria-hidden>
          {lines.map((line) => {
            const dim = active && line.experimentId !== active.id;
            if (line.kind === "usage") {
              return <path key={line.key} d={line.d} fill="none" stroke="var(--outline)" strokeWidth={1.25} strokeDasharray="1 4" strokeLinecap="round" opacity={dim ? 0.15 : 0.8} />;
            }
            return (
              <path
                key={line.key}
                d={line.d}
                fill="none"
                stroke={line.verdict ? STROKE[line.verdict] : "var(--outline)"}
                strokeWidth={active && !dim ? 3.5 : 2.5}
                strokeDasharray={line.verdict ? DASH[line.verdict] : undefined}
                opacity={dim ? 0.15 : 0.95}
              />
            );
          })}
        </svg>

        <div>
          <h3 className="type-label mb-2 text-on-surface-variant">Faults and conditions ({visible.length})</h3>
          {visible.length === 0 ? <p className="text-sm text-on-surface-variant">No experiments match these filters.</p> : null}
          <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
            {visible.map((e, i) => {
              const style = e.verdict ? VERDICT_STYLE[e.verdict] : null;
              return (
                // Staggered entrance: 30ms per tile, capped at 300ms.
                <li key={e.id} className="md-enter" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) left.current.set(e.id, el);
                      else left.current.delete(e.id);
                    }}
                    onClick={() => setSelected(selected === e.id ? null : e.id)}
                    aria-pressed={selected === e.id}
                    aria-label={`${e.title}: ${e.verdict ? VERDICT_LABELS[e.verdict] : e.status}. ${e.affectedSteps.length ? `Affects steps ${e.affectedSteps.map((s) => s + 1).join(", ")}.` : ""} Show details.`}
                    className={cn(
                      "relative flex min-h-12 w-full flex-col gap-1.5 rounded-lg px-4 py-3.5 text-left transition-[filter,border-radius] duration-200 hover:brightness-110 active:rounded-xl",
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
                      <span className="md-label-medium opacity-80">
                        Steps {e.affectedSteps.map((s) => s + 1).join(", ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="type-label mb-2 text-on-surface-variant">Journey steps ({steps.length})</h3>
          <ol className="flex flex-col gap-2">
            {steps.map((s) => {
              const hit = highlighted.has(s.index);
              const used = usageHighlighted.has(s.index);
              const Icon = s.isAssertion ? CheckSquare : Footprints;
              return (
                <li
                  key={s.index}
                  ref={(el) => {
                    if (el) right.current.set(s.index, el);
                    else right.current.delete(s.index);
                  }}
                  className={cn(
                    "flex gap-3 rounded-lg bg-surface-container px-4 py-3 transition-colors",
                    hit && active?.verdict && cn("ring-2", active.verdict === "broken" ? "ring-failure" : "ring-tertiary"),
                    !hit && used && "ring-1 ring-outline",
                    !s.stable && "border border-dashed border-outline",
                  )}
                >
                  <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-surface-highest text-xs">{s.index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm break-words">{s.description}</span>
                    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant">
                      <Icon aria-hidden className="size-3.5" />
                      {s.isAssertion ? "Assertion" : "Action"}
                      {!s.stable ? <span className="text-tertiary">· excluded: {s.excludedReason}</span> : null}
                      {hit ? <span className={active?.verdict === "broken" ? "text-failure" : "text-tertiary"}>· {active?.verdict === "broken" ? "failed or not reached" : "expectation violated"}</span> : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <p className="mt-4 text-xs text-on-surface-variant">
        Solid error-tone links: steps that failed or were never reached (BROKEN). Dashed tertiary links: steps that held but exceeded a budget (DEGRADED). Dotted gray links: steps during which the
        dependency was requested in the baseline run. Links are drawn on wide screens; on phones the affected steps are listed on each card.
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
                <span className="md-body-medium text-on-surface-variant">{active.reproducibility === "reproduced" ? "Reproduced in a second run" : active.reproducibility === "single-run" ? "Single run" : "Did not reproduce"}</span>
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
            {active.kind !== "offline" && active.kind !== "narrow-viewport" ? (
              <p className="md-body-medium mb-4 text-on-surface-variant">
                The fault acted on {active.affectedRequestCount} request{active.affectedRequestCount === 1 ? "" : "s"} in the first run.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link href={`/scans/${scanId}/experiments/${active.id}`} className="md-title-medium inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-6 text-on-secondary-container transition-[filter] hover:brightness-110">
                Evidence and Reality Split <ArrowRight aria-hidden className="size-5" />
              </Link>
              {active.test ? (
                <a href={`/api/experiments/${active.id}/regression-test`} download className="md-title-medium inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-6 text-on-secondary-container transition-[filter] hover:brightness-110">
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
