import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  describeStep,
  FAULT_KIND_LABELS,
  findAllowlistMatch,
  isAssertionStep,
  isTerminalScanStatus,
  VERDICT_DEFINITIONS,
  VERDICTS,
} from "@faultline/shared";
import { AnalysisActions } from "@/components/analysis/analysis-actions";
import { AnalysisLive } from "@/components/analysis/analysis-live";
import { BlastRadiusMap, type MapExperiment, type MapStep } from "@/components/analysis/blast-radius-map";
import { VerdictChip } from "@/components/analysis/verdict";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { ScanStatusChip } from "@/components/ui/status";
import { requireOperator } from "@/lib/auth/dal";
import { getAnalysis, getAnalysisStatus } from "@/lib/data/analysis";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Blast Radius" };

type Props = { params: Promise<{ scanId: string }>; searchParams: Promise<{ rerunError?: string }> };

export default async function BlastRadiusPage({ params, searchParams }: Props) {
  await requireOperator();
  const { scanId } = await params;
  const detail = await getAnalysis(scanId);
  if (!detail) notFound();
  const { scan, project } = detail;
  const { rerunError } = await searchParams;
  const snapshot = scan.journeySnapshot;
  const journey = snapshot?.definition ?? null;
  const analysis = scan.analysis;
  const terminal = isTerminalScanStatus(scan.status);
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  const status = terminal ? null : await getAnalysisStatus(scan.id);

  const depsByKey = new Map(detail.dependencies.map((d) => [d.key, d]));
  const testByExperiment = new Map(detail.regressionTests.map((t) => [t.experimentId, t]));
  const excluded = new Map((analysis?.excludedSteps ?? []).map((e) => [e.index, e.reason]));

  const steps: MapStep[] = (journey?.steps ?? []).map((step, index) => ({
    index,
    description: describeStep(step),
    isAssertion: isAssertionStep(step),
    stable: analysis ? analysis.stableSteps.includes(index) : true,
    excludedReason: excluded.get(index) ?? null,
  }));
  const experiments: MapExperiment[] = detail.experiments.map((e) => {
    const dep = e.dependencyKey ? depsByKey.get(e.dependencyKey) : undefined;
    return {
      id: e.id,
      ordinal: e.ordinal,
      kind: e.kind,
      title: e.dependencyLabel ?? (e.kind === "offline" ? "Browser goes offline after the first page loads" : "360×740 viewport"),
      party: dep?.party ?? null,
      status: e.status,
      verdict: e.verdict,
      reproducibility: e.reproducibility,
      reasons: e.reasons,
      affectedSteps: e.affectedSteps,
      requestedDuringSteps: dep?.requestedDuringSteps ?? [],
      affectedRequestCount: e.affectedRequestCount,
      test: testByExperiment.has(e.id) ? { status: testByExperiment.get(e.id)!.validationStatus } : null,
    };
  });
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, detail.experiments.filter((e) => e.verdict === v).length]));
  const notRun = detail.experiments.filter((e) => !e.verdict).length;
  const baseline = detail.executions.find((e) => e.role === "baseline");

  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>}
        title="Blast Radius"
        description={
          <span className="flex flex-col gap-1">
            <span className="text-on-surface">
              {journey ? (
                <Link className="underline-offset-4 hover:underline" href={`/projects/${project.id}/journeys/${snapshot!.id}`}>
                  {journey.name} · version {snapshot!.version}
                </Link>
              ) : (
                "Journey unavailable"
              )}
            </span>
            <span className="break-all">{scan.targetUrl}</span>
          </span>
        }
        actions={<AnalysisActions scanId={scan.id} status={scan.status} authorized={authorized} cancelRequested={Boolean(scan.cancelRequestedAt)} />}
      />

      {rerunError ? (
        <p role="alert" className="mb-6 rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {rerunError}
        </p>
      ) : null}

      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="sr-only">Status</dt>
          <dd>
            <ScanStatusChip status={scan.status} />
          </dd>
        </div>
        <div>
          <dt className="inline text-on-surface-variant">Created </dt>
          <dd className="inline">{formatDateTime(scan.createdAt)}</dd>
        </div>
        <div>
          <dt className="inline text-on-surface-variant">Duration </dt>
          <dd className="inline tabular">{formatDuration(scan.durationMs)}</dd>
        </div>
        {scan.environment ? (
          <div>
            <dt className="inline text-on-surface-variant">Browser </dt>
            <dd className="inline">
              Chromium {scan.environment.browserVersion} (Playwright {scan.environment.playwrightVersion})
            </dd>
          </div>
        ) : null}
      </dl>

      {status ? (
        <div className="mb-8 flex flex-col gap-6">
          {scan.status === "queued" ? <WorkerNotice /> : null}
          <AnalysisLive
            scanId={scan.id}
            initial={{
              status: status.status,
              phase: status.phase,
              cancelRequestedAt: status.cancelRequestedAt?.toISOString() ?? null,
              startedAt: status.startedAt?.toISOString() ?? null,
              executions: status.executions,
              experiments: status.experiments,
            }}
          />
        </div>
      ) : null}

      {scan.status === "failed" || scan.status === "cancelled" ? (
        <div role="status" className={cn("mb-6 flex gap-3 rounded-lg px-4 py-3", scan.status === "failed" ? "bg-failure-container text-on-failure-container" : "border border-dashed border-incomplete")}>
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">{scan.status === "failed" ? "FAULTLINE could not complete this analysis." : "This analysis was cancelled."}</p>
            {scan.errorMessage ? <p className="text-sm opacity-90">{scan.errorMessage}</p> : null}
            <p className="mt-1 text-sm opacity-90">Experiments that finished before it stopped are shown below with their evidence.</p>
          </div>
        </div>
      ) : null}

      {detail.experiments.length ? (
        <section aria-labelledby="summary-title" className="mb-8">
          <h2 id="summary-title" className="sr-only">
            Verdicts
          </h2>
          <ul className="flex flex-wrap gap-3">
            {VERDICTS.map((v) => (
              <li key={v} className="flex items-center gap-2 rounded-lg bg-surface-low px-4 py-3" title={VERDICT_DEFINITIONS[v]}>
                <VerdictChip verdict={v} />
                <span className="type-headline tabular text-2xl">{counts[v]}</span>
              </li>
            ))}
            {notRun ? (
              <li className="flex items-center gap-2 rounded-lg border border-dashed border-outline px-4 py-3 text-sm text-on-surface-variant">
                <span className="type-headline tabular text-2xl text-on-surface">{notRun}</span> without a verdict yet or not run
              </li>
            ) : null}
          </ul>
          <p className="mt-3 text-sm text-on-surface-variant">
            Each count is one experiment: one dependency under one fault, or one condition, in a fresh browser context. These are the experiments this analysis ran; dependencies it
            did not test are listed below. Absence of a finding is not proof of resilience for untested paths.
          </p>
        </section>
      ) : null}

      {detail.experiments.length && steps.length ? (
        <section aria-labelledby="map-title" className="mb-10">
          <h2 id="map-title" className="type-headline mb-1 text-2xl">
            Blast Radius Map
          </h2>
          <p className="mb-4 text-sm text-on-surface-variant">Select a fault to see the steps it affected, the reasons, and the evidence.</p>
          <BlastRadiusMap scanId={scan.id} steps={steps} experiments={experiments} />
        </section>
      ) : null}

      {analysis ? (
        <section aria-labelledby="calibration-title" className="mb-10 grid gap-4 lg:grid-cols-2">
          <h2 id="calibration-title" className="sr-only">
            Baseline and calibration
          </h2>
          <div className="rounded-xl bg-surface-low p-5">
            <h3 className="type-title mb-2">Baseline stability</h3>
            <p className="text-sm">
              {analysis.stableSteps.length} of {steps.length} steps passed in both normal runs and can support a verdict.
            </p>
            {analysis.excludedSteps.length ? (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-on-surface-variant">
                {analysis.excludedSteps.map((s) => (
                  <li key={s.index}>
                    Step {s.index + 1}: {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {baseline?.summary ? (
              <p className="mt-2 text-sm text-on-surface-variant">
                The baseline run recorded {baseline.summary.totalRequests} requests, {baseline.summary.failedRequests} failed requests, {baseline.summary.httpErrors} HTTP errors and{" "}
                {baseline.summary.pageErrors} uncaught page errors under normal conditions.
              </p>
            ) : null}
          </div>
          <div className="rounded-xl bg-surface-low p-5">
            <h3 className="type-title mb-2">Visual calibration</h3>
            <p className="text-sm">{analysis.calibration?.note ?? "No calibration recorded."}</p>
            {analysis.visualThreshold ? <p className="mt-2 text-sm text-on-surface-variant">{analysis.visualThreshold.explanation}</p> : null}
          </div>
        </section>
      ) : null}

      {detail.dependencies.length ? (
        <section aria-labelledby="deps-title" className="mb-10">
          <h2 id="deps-title" className="type-headline mb-1 text-2xl">
            Observed dependencies
          </h2>
          <p className="mb-4 text-sm text-on-surface-variant">
            Grouped from requests the browser made in the two normal runs. Discovery covers only what this journey requested; other pages and code paths may use more.
          </p>
          <div className="overflow-x-auto rounded-xl bg-surface-low">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-medium">Dependency</th>
                  <th className="px-4 py-3 font-medium">Origin</th>
                  <th className="px-4 py-3 font-medium">Requests</th>
                  <th className="px-4 py-3 font-medium">Median</th>
                  <th className="px-4 py-3 font-medium">Requested in steps</th>
                  <th className="px-4 py-3 font-medium">Tested</th>
                </tr>
              </thead>
              <tbody>
                {detail.dependencies.map((d) => {
                  const tested = detail.experiments.filter((e) => e.dependencyKey === d.key);
                  return (
                    <tr key={d.id} className="border-t border-outline-variant align-top">
                      <td className="px-4 py-3">
                        <span className="break-all">{d.label}</span>
                        <span className="block text-xs text-on-surface-variant">
                          {d.scope} · {d.resourceTypes.join(", ")}
                          {d.statuses.length ? ` · HTTP ${d.statuses.join(", ")}` : ""}
                          {d.failedCount ? ` · ${d.failedCount} failed normally` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">{d.party === "first-party" ? "First-party" : "Third-party"}</td>
                      <td className="tabular px-4 py-3">{d.requestCount}</td>
                      <td className="tabular px-4 py-3">{formatDuration(d.medianDurationMs)}</td>
                      <td className="px-4 py-3">{d.requestedDuringSteps.length ? d.requestedDuringSteps.map((s) => s + 1).join(", ") : "Before or between steps"}</td>
                      <td className="px-4 py-3">
                        {tested.length ? (
                          <ul className="flex flex-col gap-1">
                            {tested.map((e) => (
                              <li key={e.id}>
                                <Link href={`/scans/${scan.id}/experiments/${e.id}`} className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline">
                                  {FAULT_KIND_LABELS[e.kind as keyof typeof FAULT_KIND_LABELS] ?? e.kind}
                                  {e.verdict ? <VerdictChip verdict={e.verdict} size="sm" /> : null}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-on-surface-variant">{d.eligibleFaults.length ? "Not selected" : (d.ineligibleReason ?? "Not eligible")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {analysis?.skippedCandidates.length ? (
            <details className="mt-4 rounded-lg border border-outline-variant p-4">
              <summary className="cursor-pointer text-sm font-medium">{analysis.skippedCandidates.length} candidate experiments not run, with reasons</summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-on-surface-variant">
                {analysis.skippedCandidates.map((c, i) => (
                  <li key={i} className="break-all">
                    {FAULT_KIND_LABELS[c.fault]} · {depsByKey.get(c.dependencyKey)?.label ?? c.dependencyKey}: {c.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
