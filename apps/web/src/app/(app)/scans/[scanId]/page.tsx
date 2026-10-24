import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeScenario, findAllowlistMatch, isTerminalScanStatus, SCENARIO_LABELS } from "@faultline/shared";
import { EvidenceTimeline, problemEvents } from "@/components/scan/evidence-timeline";
import { RunSummary } from "@/components/scan/run-summary";
import { ScanActions } from "@/components/scan/scan-actions";
import { ScanLive } from "@/components/scan/scan-live";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { ScanStatusChip } from "@/components/ui/status";
import { requireOperator } from "@/lib/auth/dal";
import { getScanDetail } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatDuration } from "@/lib/format";
import { reportFromDetail } from "@/lib/report";
import { cn } from "@/lib/cn";

type Props = { params: Promise<{ scanId: string }>; searchParams: Promise<{ rerunError?: string }> };

export const metadata: Metadata = { title: "Scan" };

const FACT_TONE = { neutral: "border-outline-variant", difference: "border-primary", failure: "border-failure" } as const;

export default async function ScanPage({ params, searchParams }: Props) {
  await requireOperator();
  const detail = await getScanDetail((await params).scanId);
  if (!detail) notFound();
  const { scan, project, executions } = detail;
  const { rerunError } = await searchParams;
  const terminal = isTerminalScanStatus(scan.status);
  const report = terminal ? reportFromDetail(detail) : null;
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));

  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>}
        title={SCENARIO_LABELS[scan.scenarioKind]}
        description={
          <span className="flex flex-col gap-1">
            <span className="break-all text-on-surface">{scan.targetUrl}</span>
            <span>{describeScenario(scan.scenarioConfig)}</span>
          </span>
        }
        actions={<ScanActions scanId={scan.id} status={scan.status} authorized={authorized} cancelRequested={Boolean(scan.cancelRequestedAt)} />}
      />

      {rerunError ? (
        <p role="alert" className="mb-6 rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {rerunError}
        </p>
      ) : null}

      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
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

      {!terminal ? (
        <div className="flex flex-col gap-6">
          {scan.status === "queued" ? <WorkerNotice /> : null}
          <ScanLive
            scanId={scan.id}
            initial={{
              status: scan.status,
              phase: scan.phase,
              cancelRequestedAt: scan.cancelRequestedAt?.toISOString() ?? null,
              startedAt: scan.startedAt?.toISOString() ?? null,
              executions: executions.map((e) => ({ role: e.role, status: e.status, outcome: e.outcome, durationMs: e.durationMs })),
            }}
          />
        </div>
      ) : null}

      {scan.status === "failed" || scan.status === "cancelled" ? (
        <div role="status" className={cn("mb-6 flex gap-3 rounded-lg px-4 py-3", scan.status === "failed" ? "bg-failure-container text-on-failure-container" : "border border-dashed border-incomplete")}>
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">{scan.status === "failed" ? "FAULTLINE could not complete this scan." : "This scan was cancelled."}</p>
            {scan.errorMessage ? <p className="text-sm opacity-90">{scan.errorMessage}</p> : null}
            {scan.errorCode ? <p className="mt-1 text-xs opacity-75">Code: {scan.errorCode}</p> : null}
          </div>
        </div>
      ) : null}

      {terminal && executions.length ? (
        <>
          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            {executions.map((execution) => (
              <RunSummary key={execution.id} execution={execution} />
            ))}
          </div>

          {report ? (
            <section aria-labelledby="facts-title" className="mb-8">
              <h2 id="facts-title" className="type-headline mb-1 text-2xl">
                What changed
              </h2>
              <p className="mb-4 text-sm text-on-surface-variant">Restatements of the recorded evidence. No diagnosis is implied.</p>
              <ul className="flex flex-col gap-2">
                {report.comparison.facts.map((fact) => (
                  <li key={fact.id} className={cn("rounded-md border-l-4 bg-surface-low px-4 py-3", FACT_TONE[fact.tone])}>
                    {fact.statement}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm">
                <Link href={`/scans/${scan.id}/split`} className="text-primary underline-offset-4 hover:underline">
                  Compare both runs in Reality Split
                </Link>{" "}
                <span className="text-on-surface-variant">or read the</span>{" "}
                <Link href={`/scans/${scan.id}/report`} className="text-primary underline-offset-4 hover:underline">
                  full report
                </Link>
                .
              </p>
            </section>
          ) : null}

          <section aria-labelledby="problems-title">
            <h2 id="problems-title" className="type-headline mb-4 text-2xl">
              Problems observed
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {executions.map((execution) => (
                <div key={execution.id} className="rounded-xl bg-surface-low p-5">
                  <h3 className={cn("type-title mb-2", execution.role === "baseline" ? "text-normal" : "text-fault")}>
                    {execution.role === "baseline" ? "Normal conditions" : "Fault conditions"}
                  </h3>
                  <EvidenceTimeline events={problemEvents(execution.events)} emptyText="No errors, failed requests, or HTTP errors were recorded." />
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
