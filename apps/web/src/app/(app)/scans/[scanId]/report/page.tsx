import { CheckCircle2, CircleHelp, FileJson, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EVIDENCE_KIND_LABELS, isTerminalScanStatus, SCAN_STATUS_LABELS, type EvidenceEvent } from "@faultline/shared";
import { ROLE_STYLE } from "@/components/scan/run-summary";
import { BackLink } from "@/design/components/back-link";
import { EmptyState } from "@/design/components/empty-state";
import { PageHeader } from "@/design/components/page-header";
import { OutcomeChip } from "@/design/components/status";
import { requireOperator } from "@/lib/auth/dal";
import { getScanDetail } from "@/lib/data/queries";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { reportFromDetail } from "@/lib/report";
import { buttonStyle, LinkButton } from "@/design/components";

export const metadata: Metadata = { title: "Report" };

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-outline-variant py-8">
      <h2 id={id} className="type-headline mb-4 text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function EventTable({ events, empty }: { events: EvidenceEvent[]; empty: string }) {
  if (!events.length) return <p className="text-sm text-on-surface-variant">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-surface-container text-on-surface-variant">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Time (UTC)</th>
            <th scope="col" className="px-3 py-2 font-medium">Kind</th>
            <th scope="col" className="px-3 py-2 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq} className="border-t border-outline-variant/60 align-top">
              <td className="tabular px-3 py-2 whitespace-nowrap text-on-surface-variant">{e.occurredAt.slice(11, 23)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {EVIDENCE_KIND_LABELS[e.kind]}
                {e.statusCode ? <span className="tabular"> {e.statusCode}</span> : null}
              </td>
              <td className="px-3 py-2">
                <span className="break-words whitespace-pre-wrap">{e.message}</span>
                {e.url ? <span className="block text-xs break-all text-on-surface-variant">{e.url}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ scanId: string }> }) {
  await requireOperator();
  const detail = await getScanDetail((await params).scanId);
  if (!detail) notFound();
  // Blast Radius analyses have their own views.
  if (detail.scan.scenarioKind === "blast-radius") redirect(`/scans/${detail.scan.id}/blast-radius`);
  if (!isTerminalScanStatus(detail.scan.status)) {
    return (
      <>
        <PageHeader back={<BackLink href={`/scans/${detail.scan.id}`}>Scan</BackLink>} title="Report" />
        <EmptyState icon={Hourglass} title="The report is written when the scan finishes" action={<LinkButton href={`/scans/${detail.scan.id}`}>Watch progress</LinkButton>} />
      </>
    );
  }
  const report = reportFromDetail(detail);
  const env = report.scan.environment;

  return (
    <article className="max-w-5xl">
      <PageHeader
        back={<BackLink href={`/scans/${report.scan.id}`}>Scan</BackLink>}
        title="Scan report"
        description={`Generated ${formatDateTime(report.generatedAt)} from stored evidence. Schema ${report.schema}.`}
        actions={
          <a href={`/api/scans/${report.scan.id}/report`} download className={buttonStyle("filled")}>
            <FileJson aria-hidden />
            Export JSON
          </a>
        }
      />

      <Section title="Target and scenario" id="target">
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
          <Row label="Project">{report.project.name} ({report.project.origin})</Row>
          <Row label="Target URL">{report.scan.targetUrl}</Row>
          <Row label="Scenario">{report.scan.scenarioSummary}</Row>
          <Row label="Configuration">
            <code className="font-mono text-xs">{JSON.stringify(report.scan.scenario)}</code>
          </Row>
          <Row label="Scan status">{SCAN_STATUS_LABELS[report.scan.status]}{report.scan.errorMessage ? ` · ${report.scan.errorMessage}` : ""}</Row>
          <Row label="Queued">{formatDateTime(report.scan.createdAt)}</Row>
          <Row label="Started">{formatDateTime(report.scan.startedAt)}</Row>
          <Row label="Finished">{formatDateTime(report.scan.finishedAt)}</Row>
          <Row label="Duration">{formatDuration(report.scan.durationMs)}</Row>
          <Row label="Scan ID">
            <code className="font-mono text-xs">{report.scan.id}</code>
          </Row>
        </dl>
      </Section>

      <Section title="Environment" id="environment">
        {env ? (
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
            <Row label="Browser">
              {env.browserName} {env.browserVersion} ({env.headless ? "headless" : "headed"}, sandbox {env.chromiumSandbox ? "on" : "off"})
            </Row>
            <Row label="Automation">Playwright {env.playwrightVersion}</Row>
            <Row label="Worker">FAULTLINE {env.workerVersion} on {env.platform}, Node {env.nodeVersion}</Row>
            <Row label="Deployment mode">{env.deploymentMode}</Row>
            <Row label="Egress control">
              {env.egress.guard}; subresources: {env.egress.subresourcePolicy}; private network: {env.egress.privateNetworkAccess}
            </Row>
            <Row label="Limits">
              navigation {formatDuration(env.limits.navigationTimeoutMs)}, settle {formatDuration(env.limits.settleTimeoutMs)}, scenario{" "}
              {formatDuration(env.limits.scenarioTimeoutMs)}, {env.limits.maxRedirects} redirects, {env.limits.maxRequests} requests,{" "}
              {formatBytes(env.limits.maxTransferBytes)} transfer
            </Row>
          </dl>
        ) : (
          <p className="text-sm text-on-surface-variant">The worker did not record an environment for this scan (it stopped before starting the browser).</p>
        )}
      </Section>

      <Section title="Outcomes" id="outcomes">
        <div className="grid gap-4 md:grid-cols-2">
          {report.executions.map((e) => (
            <div key={e.id} className={cn("rounded-xl border-t-4 bg-surface-low p-5", ROLE_STYLE[e.role].border)}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className={cn("type-title", ROLE_STYLE[e.role].text)}>{e.label}</h3>
                <OutcomeChip outcome={e.outcome} />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <Row label="Started">{formatDateTime(e.startedAt)}</Row>
                <Row label="Duration">{formatDuration(e.durationMs)}</Row>
                <Row label="HTTP status">{e.httpStatus ?? "none"}</Row>
                <Row label="Title">{e.pageTitle || "none"}</Row>
                <Row label="Final URL">
                  <span className="break-all">{e.finalUrl ?? "none"}</span>
                </Row>
                {e.navigationError ? <Row label="Error">{e.navigationError}</Row> : null}
                <Row label="User agent">
                  <span className="text-xs">{e.userAgent ?? "unknown"}</span>
                </Row>
              </dl>
              {e.screenshot ? (
                <a href={`/api/artifacts/${e.screenshot.id}`} target="_blank" rel="noreferrer" className="mt-4 block overflow-hidden rounded-lg ring-1 ring-outline-variant">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact stream */}
                  <img src={`/api/artifacts/${e.screenshot.id}`} alt={`Screenshot, ${e.label.toLowerCase()}`} className="max-h-72 w-full object-cover object-top" loading="lazy" />
                </a>
              ) : null}
              {e.screenshot ? (
                <p className="mt-2 font-mono text-xs break-all text-on-surface-variant">
                  sha256 {e.screenshot.sha256} · {formatBytes(e.screenshot.byteSize)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recorded differences" id="differences">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {report.comparison.facts.map((f) => (
            <li key={f.id}>{f.statement}</li>
          ))}
        </ul>
        {report.comparison.consoleErrorsOnlyInFault.length ? (
          <div className="mt-4">
            <h3 className="type-title mb-2">Errors seen only under fault conditions</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {report.comparison.consoleErrorsOnlyInFault.map((m) => (
                <li key={m} className="rounded-sm bg-failure-container/40 px-3 py-1.5 break-words">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {report.executions.map((e) => {
        const intentional = e.events.filter((ev) => ev.kind === "fault_injected");
        const problems = e.events.filter((ev) => ["page_error", "console", "request_failed", "http_error", "policy_block"].includes(ev.kind) && ev.severity !== "info");
        return (
          <Section key={e.id} title={`Captured errors and failed requests: ${e.label.toLowerCase()}`} id={`errors-${e.role}`}>
            <EventTable events={problems} empty="No console errors, uncaught exceptions, failed requests, HTTP errors, or egress refusals were recorded." />
            {intentional.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-fault">
                  {intentional.length} request{intentional.length === 1 ? "" : "s"} aborted on purpose by FAULTLINE
                </summary>
                <div className="mt-3">
                  <EventTable events={intentional} empty="" />
                </div>
              </details>
            ) : null}
          </Section>
        );
      })}

      <Section title="What this evidence supports" id="conclusions">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="type-title mb-3 flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-5 text-success" /> Can be concluded
            </h3>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {report.interpretation.canConclude.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="type-title mb-3 flex items-center gap-2">
              <CircleHelp aria-hidden className="size-5 text-incomplete" /> Cannot be concluded
            </h3>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {report.interpretation.cannotConclude.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-6 text-xs text-on-surface-variant">{report.integrity.note}</p>
      </Section>
    </article>
  );
}
