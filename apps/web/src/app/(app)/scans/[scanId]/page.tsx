import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { describeScenario, findAllowlistMatch, isTerminalScanStatus, SCENARIO_LABELS } from "@faultline/shared";
import { ConsoleRows, NetworkRows } from "@/components/scan/evidence-rows";
import { EvidenceTimeline, problemEvents } from "@/components/scan/evidence-timeline";
import { RunSummary } from "@/components/scan/run-summary";
import { ScanActions } from "@/components/scan/scan-actions";
import { ScanLive } from "@/components/scan/scan-live";
import { ScanTabs } from "@/components/scan/scan-tabs";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/design/components/back-link";
import { PageHeader } from "@/design/components/page-header";
import { ScanStatusChip } from "@/design/components/status";
import { requireOperator } from "@/lib/auth/dal";
import { getScanDetail } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatDuration } from "@/lib/format";
import { reportFromDetail } from "@/lib/report";
import { cn } from "@/lib/cn";
import { Card, DisplayNumeral, LinkButton, SegmentedProgress, type SegmentState } from "@/design/components";

type Props = { params: Promise<{ scanId: string }>; searchParams: Promise<{ rerunError?: string }> };

export const metadata: Metadata = { title: "Scan" };

const FACT_TONE = {
  neutral: "bg-surface-container text-on-surface",
  difference: "bg-secondary-container text-on-secondary-container",
  failure: "bg-error-container text-on-error-container",
} as const;

function phaseSegments(status: string): Array<{ label: string; state: SegmentState }> {
  const terminalState: SegmentState = status === "completed" ? "done" : status === "failed" || status === "cancelled" ? "failed" : "pending";
  return [
    { label: "Queued", state: status === "queued" ? "active" : "done" },
    { label: "Running", state: status === "queued" ? "pending" : status === "running" ? "active" : "done" },
    { label: "Finished", state: terminalState },
  ];
}

export default async function ScanPage({ params, searchParams }: Props) {
  await requireOperator();
  const detail = await getScanDetail((await params).scanId);
  if (!detail) notFound();
  // Blast Radius analyses have their own views.
  if (detail.scan.scenarioKind === "blast-radius") redirect(`/scans/${detail.scan.id}/blast-radius`);
  const { scan, project, executions } = detail;
  const { rerunError } = await searchParams;
  const terminal = isTerminalScanStatus(scan.status);
  const report = terminal ? reportFromDetail(detail) : null;
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  const faultSummary = executions.find((e) => e.role === "fault")?.summary ?? null;
  const runLabel = (role: string) => (role === "baseline" ? "Normal conditions" : "Fault conditions");

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
        <p role="alert" className="mb-6 rounded-md bg-error-container px-4 py-3 md-body-medium text-on-error-container">
          {rerunError}
        </p>
      ) : null}

      <Card tier="high" aria-label="Scan summary" className="mb-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ScanStatusChip status={scan.status} />
          <span className="md-body-medium text-on-surface-variant">Created {formatDateTime(scan.createdAt)}</span>
          {scan.environment ? (
            <span className="md-body-medium text-on-surface-variant">
              Chromium {scan.environment.browserVersion} (Playwright {scan.environment.playwrightVersion})
            </span>
          ) : null}
        </div>
        {faultSummary ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DisplayNumeral
              value={faultSummary.failedRequests + faultSummary.httpErrors}
              caption="Failed requests under fault"
              tone={faultSummary.failedRequests + faultSummary.httpErrors ? "text-error" : "text-on-surface"}
            />
            <DisplayNumeral
              value={faultSummary.consoleErrors + faultSummary.pageErrors}
              caption="Console errors under fault"
              tone={faultSummary.consoleErrors + faultSummary.pageErrors ? "text-error" : "text-on-surface"}
            />
            <DisplayNumeral value={faultSummary.intentionallyBlocked} caption="Blocked on purpose" />
            <DisplayNumeral value={formatDuration(scan.durationMs)} caption="Duration" />
          </div>
        ) : (
          <DisplayNumeral value={formatDuration(scan.durationMs)} caption="Duration" />
        )}
        <SegmentedProgress label="Scan phases" segments={phaseSegments(scan.status)} />
      </Card>

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
        <div
          role="status"
          className={cn(
            "mb-6 flex gap-3 rounded-lg px-4 py-3",
            scan.status === "failed" ? "bg-error-container text-on-error-container" : "bg-surface-high text-on-surface",
          )}
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">{scan.status === "failed" ? "FAULTLINE could not complete this scan." : "This scan was cancelled."}</p>
            {scan.errorMessage ? <p className="text-sm opacity-90">{scan.errorMessage}</p> : null}
            {scan.errorCode ? <p className="mt-1 text-xs opacity-75">Code: {scan.errorCode}</p> : null}
          </div>
        </div>
      ) : null}

      {terminal && executions.length ? (
        <ScanTabs
          panels={{
            overview: (
              <>
                <div className="mb-8 grid gap-4 lg:grid-cols-2">
                  {executions.map((execution) => (
                    <RunSummary key={execution.id} execution={execution} />
                  ))}
                </div>

                {report ? (
                  <section aria-labelledby="facts-title" className="mb-8">
                    <h2 id="facts-title" className="md-headline-medium mb-1">
                      What changed
                    </h2>
                    <p className="mb-4 md-body-medium text-on-surface-variant">Restatements of the recorded evidence. No diagnosis is implied.</p>
                    <ul className="flex flex-col gap-0.5">
                      {report.comparison.facts.map((fact) => (
                        <li key={fact.id} className={cn("rounded-sm px-4 py-3 first:rounded-t-lg last:rounded-b-lg", FACT_TONE[fact.tone])}>
                          {fact.statement}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 md-body-medium">
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
                  <h2 id="problems-title" className="md-headline-medium mb-4">
                    Problems observed
                  </h2>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {executions.map((execution) => (
                      <Card key={execution.id} tier="low">
                        <h3 className={cn("md-title-large mb-2", execution.role === "baseline" ? "text-normal" : "text-fault")}>{runLabel(execution.role)}</h3>
                        <EvidenceTimeline events={problemEvents(execution.events)} emptyText="No errors, failed requests, or HTTP errors were recorded." />
                      </Card>
                    ))}
                  </div>
                </section>
              </>
            ),
            timeline: (
              <div className="grid gap-4 lg:grid-cols-2">
                {executions.map((execution) => (
                  <Card key={execution.id} tier="low">
                    <h3 className={cn("md-title-large mb-2", execution.role === "baseline" ? "text-normal" : "text-fault")}>{runLabel(execution.role)}</h3>
                    <EvidenceTimeline events={execution.events} />
                  </Card>
                ))}
              </div>
            ),
            network: (
              <div className="grid gap-4 lg:grid-cols-2">
                {executions.map((execution) => (
                  <Card key={execution.id} tier="low">
                    <h3 className={cn("md-title-large mb-2", execution.role === "baseline" ? "text-normal" : "text-fault")}>{runLabel(execution.role)}</h3>
                    <NetworkRows events={execution.events} emptyText="No failed, blocked, or erroring requests were recorded." />
                  </Card>
                ))}
              </div>
            ),
            console: (
              <div className="grid gap-4 lg:grid-cols-2">
                {executions.map((execution) => (
                  <Card key={execution.id} tier="low">
                    <h3 className={cn("md-title-large mb-2", execution.role === "baseline" ? "text-normal" : "text-fault")}>{runLabel(execution.role)}</h3>
                    <ConsoleRows events={execution.events} emptyText="No console messages or page exceptions were recorded." />
                  </Card>
                ))}
              </div>
            ),
            screenshots: (
              <div className="grid gap-4 sm:grid-cols-2">
                {executions.map((execution) => (
                  <Card key={execution.id} tier="low" className="flex flex-col gap-3">
                    <h3 className={cn("md-title-large", execution.role === "baseline" ? "text-normal" : "text-fault")}>{runLabel(execution.role)}</h3>
                    {execution.screenshot ? (
                      <Link href={`/scans/${scan.id}/split`} className="block overflow-hidden rounded-lg bg-surface-container">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private artifact served by an authenticated route */}
                        <img
                          src={`/api/artifacts/${execution.screenshot.id}`}
                          alt={`Screenshot, ${runLabel(execution.role).toLowerCase()}`}
                          className="max-h-96 w-full object-cover object-top"
                          loading="lazy"
                        />
                      </Link>
                    ) : (
                      <p className="md-body-medium text-on-surface-variant">No screenshot: the page did not render content to capture.</p>
                    )}
                  </Card>
                ))}
                <LinkButton variant="tonal" href={`/scans/${scan.id}/split`} className="sm:col-span-2 sm:justify-self-start">
                  Open Reality Split
                </LinkButton>
              </div>
            ),
          }}
        />
      ) : null}
    </>
  );
}
