import { Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EXPERIMENT_KIND_LABELS, EXPERIMENT_KINDS, VERDICT_LABELS, VERDICTS } from "@faultline/shared";
import { ExperimentStateChip, KindLabel } from "@/components/analysis/verdict";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClasses } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { listExperiments, normalizeExperimentFilters } from "@/lib/data/analysis";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Findings" };

const TEST_LABEL = { fails_as_expected: "Test validated", passes: "Test passed", error: "Test error", not_run: "Test not validated" } as const;

export default async function ExperimentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const filters = normalizeExperimentFilters(await searchParams);
  const rows = await listExperiments(filters);
  const filtered = Boolean(filters.verdict || filters.kind);
  return (
    <>
      <PageHeader title="Findings" description="Every Blast Radius experiment across projects, newest first. Filter by verdict to see what broke." />
      <form method="get" action="/experiments" className="mb-5 grid gap-3 sm:grid-cols-[auto_auto_auto] sm:items-end sm:justify-start">
        <label className="flex flex-col gap-1.5">
          <span className="type-label">Verdict</span>
          <select name="verdict" defaultValue={filters.verdict ?? ""} className={cn(inputClasses, "h-12 bg-surface pr-8")}>
            <option value="">Any verdict</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {VERDICT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="type-label">Fault</span>
          <select name="kind" defaultValue={filters.kind ?? ""} className={cn(inputClasses, "h-12 bg-surface pr-8")}>
            <option value="">Any fault</option>
            {EXPERIMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPERIMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="tonal" size="lg" className="h-12">
            Filter
          </Button>
          {filtered ? (
            <LinkButton href="/experiments" variant="text" size="lg" className="h-12">
              Clear
            </LinkButton>
          ) : null}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={Zap} title={filtered ? "No experiments match these filters" : "No experiments yet"}>
          {filtered ? "Clear the filters to see every experiment." : "Create a journey in a project and launch a Blast Radius analysis."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/scans/${r.scanId}/experiments/${r.id}`} className="flex flex-col gap-2 rounded-lg bg-surface-low px-5 py-4 transition-colors hover:bg-surface-container sm:flex-row sm:items-center sm:gap-6">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <KindLabel kind={r.kind} className="text-sm text-on-surface-variant" />
                  <span className="break-all">{r.dependencyLabel ?? EXPERIMENT_KIND_LABELS[r.kind]}</span>
                  <span className="text-sm text-on-surface-variant">
                    {r.projectName} · {r.journeyName ?? "journey"} v{r.journeyVersion ?? "?"}
                    {r.affectedSteps.length && (r.verdict === "broken" || r.verdict === "degraded") ? ` · steps ${r.affectedSteps.map((s) => s + 1).join(", ")}` : ""}
                    {r.testStatus ? ` · ${TEST_LABEL[r.testStatus]}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-on-surface-variant">{formatRelative(r.createdAt)}</span>
                  <ExperimentStateChip status={r.status} verdict={r.verdict} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
