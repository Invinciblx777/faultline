"use client";

import { ArrowRight, CheckSquare, Download, Footprints, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VERDICT_DEFINITIONS, VERDICT_LABELS, VERDICTS, type ExperimentKind, type Reproducibility, type Verdict } from "@faultline/shared";
import type { ExperimentStatus } from "@faultline/db";
import { ExperimentStateChip, KindLabel, VERDICT_STYLE } from "@/components/analysis/verdict";
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
  degraded: "var(--incomplete)",
  resilient: "var(--success)",
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
                className={cn("type-label inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-opacity", on ? cn(style.chip, "border-transparent") : "border-outline text-on-surface-variant opacity-60")}
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
            <select value={party} onChange={(e) => setParty(e.target.value as typeof party)} className="h-9 rounded-md border border-outline bg-surface-low px-2">
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
          <ul className="flex flex-col gap-2">
            {visible.map((e) => {
              const style = e.verdict ? VERDICT_STYLE[e.verdict] : null;
              return (
                <li key={e.id}>
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
                      "relative flex w-full flex-col gap-1.5 rounded-lg border-l-4 bg-surface-low px-4 py-3 text-left transition-colors hover:bg-surface-container",
                      style ? style.border : "border-outline-variant",
                      selected === e.id && "bg-surface-container ring-2 ring-primary",
                    )}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <KindLabel kind={e.kind} className="text-sm text-on-surface-variant" />
                      <ExperimentStateChip status={e.status} verdict={e.verdict} />
                    </span>
                    <span className="break-all text-sm font-medium">{e.title}</span>
                    {e.affectedSteps.length && (e.verdict === "broken" || e.verdict === "degraded") ? (
                      <span className="text-xs text-on-surface-variant">
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
                    "flex gap-3 rounded-lg bg-surface-low px-4 py-3 transition-colors",
                    hit && active?.verdict && cn("ring-2", active.verdict === "broken" ? "ring-failure" : "ring-incomplete"),
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
                      {!s.stable ? <span className="text-incomplete">· excluded: {s.excludedReason}</span> : null}
                      {hit ? <span className={active?.verdict === "broken" ? "text-failure" : "text-incomplete"}>· {active?.verdict === "broken" ? "failed or not reached" : "expectation violated"}</span> : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <p className="mt-4 text-xs text-on-surface-variant">
        Solid red links: steps that failed or were never reached (BROKEN). Dashed amber links: steps that held but exceeded a budget (DEGRADED). Dotted gray links: steps during which the
        dependency was requested in the baseline run. Links are drawn on wide screens; on phones the affected steps are listed on each card.
      </p>

      {active ? (
        <aside
          aria-label="Experiment details"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border-t border-outline-variant bg-surface-high p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:top-6 md:right-6 md:bottom-6 md:max-h-none md:w-[26rem] md:rounded-xl md:border"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <KindLabel kind={active.kind} className="text-sm text-on-surface-variant" />
              <h3 className="type-title mt-1 break-all">{active.title}</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close details" className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-surface-highest">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ExperimentStateChip status={active.status} verdict={active.verdict} />
            {active.reproducibility && active.reproducibility !== "not-applicable" ? (
              <span className="text-sm text-on-surface-variant">{active.reproducibility === "reproduced" ? "Reproduced in a second run" : active.reproducibility === "single-run" ? "Single run" : "Did not reproduce"}</span>
            ) : null}
          </div>
          {active.verdict ? <p className="mb-3 text-sm text-on-surface-variant">{VERDICT_DEFINITIONS[active.verdict]}</p> : null}
          {active.reasons.length ? (
            <ul className="mb-4 flex list-disc flex-col gap-1 pl-5 text-sm">
              {active.reasons.map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
          ) : null}
          <p className="mb-4 text-sm text-on-surface-variant">
            The fault acted on {active.affectedRequestCount} request{active.affectedRequestCount === 1 ? "" : "s"} in the first run.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/scans/${scanId}/experiments/${active.id}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-on-primary">
              Evidence and Reality Split <ArrowRight aria-hidden className="size-4" />
            </Link>
            {active.test ? (
              <a href={`/api/experiments/${active.id}/regression-test`} download className="inline-flex h-11 items-center gap-2 rounded-full border border-outline px-5">
                <Download aria-hidden className="size-4" /> Regression test
              </a>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
