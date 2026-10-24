import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EXECUTION_OUTCOME_LABELS, EXECUTION_ROLE_LABELS, isTerminalScanStatus, SCENARIO_LABELS, type ExecutionRole } from "@faultline/shared";
import { EvidenceTimeline } from "@/components/scan/evidence-timeline";
import { RealitySplit, type SplitShot } from "@/components/scan/reality-split";
import { ROLE_STYLE, RunSummary } from "@/components/scan/run-summary";
import { BackLink } from "@/design/components/back-link";
import { EmptyState } from "@/design/components/empty-state";
import { PageHeader } from "@/design/components/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getScanDetail, type ScanDetail } from "@/lib/data/queries";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Hourglass } from "lucide-react";
import { LinkButton } from "@/design/components";

export const metadata: Metadata = { title: "Reality Split" };

type Execution = ScanDetail["executions"][number];

function shotFor(role: ExecutionRole, execution: Execution | undefined): SplitShot {
  const missingReason = !execution
    ? "This execution did not run."
    : execution.status !== "completed"
      ? "This execution did not complete, so no screenshot was captured."
      : execution.outcome === "left_authorized_scope"
        ? "The page left the authorized origin, so FAULTLINE stopped before capturing it."
        : execution.navigationError
          ? `No page rendered to capture: ${execution.navigationError}`
          : "No screenshot was captured for this execution.";
  return {
    role,
    tone: role === "baseline" || role === "calibration" ? "normal" : "fault",
    label: EXECUTION_ROLE_LABELS[role],
    outcomeLabel: execution?.outcome ? EXECUTION_OUTCOME_LABELS[execution.outcome] : null,
    artifactId: execution?.screenshot?.id ?? null,
    width: execution?.screenshot?.width ?? null,
    height: execution?.screenshot?.height ?? null,
    sha256: execution?.screenshot?.sha256 ?? null,
    missingReason,
  };
}

function Conditions({ execution }: { execution: Execution }) {
  const c = execution.conditions;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-on-surface-variant">Network</dt>
        <dd>{c.network === "normal" ? "Normal" : c.network === "resource-block" ? "Selected resources aborted" : "Offline (browser-context emulation)"}</dd>
        {c.blockedResourceTypes ? (
          <>
            <dt className="text-on-surface-variant">Aborted types</dt>
            <dd>
              {c.blockedResourceTypes.join(", ")} · {c.blockScope} · error <code className="font-mono">{c.abortErrorCode}</code>
            </dd>
          </>
        ) : null}
        <dt className="text-on-surface-variant">Viewport</dt>
        <dd>
          {execution.viewport ? `${execution.viewport.width}×${execution.viewport.height}${execution.viewport.isMobile ? " (mobile emulation)" : ""}` : c.viewport}
        </dd>
        <dt className="text-on-surface-variant">Service workers</dt>
        <dd>{c.serviceWorkers === "block" ? "Blocked" : "Allowed"}</dd>
        <dt className="text-on-surface-variant">Browser</dt>
        <dd>
          {execution.browserName ?? "—"} {execution.browserVersion ?? ""}
        </dd>
        <dt className="text-on-surface-variant">Started</dt>
        <dd>{formatDateTime(execution.startedAt)}</dd>
        {execution.screenshot ? (
          <>
            <dt className="text-on-surface-variant">Screenshot</dt>
            <dd className="min-w-0">
              {execution.screenshot.width}×{execution.screenshot.height}, {formatBytes(execution.screenshot.byteSize)}
              <span className="block truncate font-mono text-xs text-on-surface-variant" title={execution.screenshot.sha256}>
                sha256 {execution.screenshot.sha256}
              </span>
            </dd>
          </>
        ) : null}
      </dl>
      <ol className="flex flex-wrap gap-1.5" aria-label="Steps performed">
        {c.steps.map((step, i) => (
          <li key={step} className="rounded-sm bg-surface-high px-2 py-1 text-xs text-on-surface-variant">
            {i + 1}. {step}
          </li>
        ))}
      </ol>
      {c.notes.map((note) => (
        <p key={note} className="text-xs text-on-surface-variant">
          {note}
        </p>
      ))}
    </div>
  );
}

export default async function SplitPage({ params }: { params: Promise<{ scanId: string }> }) {
  await requireOperator();
  const detail = await getScanDetail((await params).scanId);
  if (!detail) notFound();
  // Blast Radius analyses have their own views.
  if (detail.scan.scenarioKind === "blast-radius") redirect(`/scans/${detail.scan.id}/blast-radius`);
  const { scan } = detail;
  const baseline = detail.executions.find((e) => e.role === "baseline");
  const fault = detail.executions.find((e) => e.role === "fault");

  return (
    <>
      <PageHeader
        back={<BackLink href={`/scans/${scan.id}`}>Scan</BackLink>}
        title="Reality Split"
        description={
          <span className="flex flex-col gap-1">
            <span className="break-all text-on-surface">{scan.targetUrl}</span>
            <span>
              {SCENARIO_LABELS[scan.scenarioKind]}. Both runs are real Chromium executions in separate, fresh browser contexts.
            </span>
          </span>
        }
        actions={
          <LinkButton href={`/scans/${scan.id}/report`} variant="tonal">
            Open report
          </LinkButton>
        }
      />
      {!isTerminalScanStatus(scan.status) ? (
        <EmptyState icon={Hourglass} title="This scan is still running" action={<LinkButton href={`/scans/${scan.id}`}>Watch progress</LinkButton>}>
          Reality Split becomes available once both executions have finished.
        </EmptyState>
      ) : (
        <>
          <RealitySplit shots={[shotFor("baseline", baseline), shotFor("fault", fault)]} />

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {[baseline, fault].map((execution) =>
              execution ? <RunSummary key={execution.id} execution={execution} /> : null,
            )}
          </div>

          <section aria-labelledby="conditions-title" className="mt-10">
            <h2 id="conditions-title" className="type-headline mb-4 text-2xl">
              Conditions and environment
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {[baseline, fault].map((execution) =>
                execution ? (
                  <div key={execution.id} className="rounded-xl bg-surface-low p-5">
                    <h3 className={cn("type-title mb-3", ROLE_STYLE[execution.role].text)}>{EXECUTION_ROLE_LABELS[execution.role]}</h3>
                    <Conditions execution={execution} />
                  </div>
                ) : null,
              )}
            </div>
          </section>

          <section aria-labelledby="timeline-title" className="mt-10">
            <h2 id="timeline-title" className="type-headline mb-1 text-2xl">
              Evidence timeline
            </h2>
            <p className="mb-4 text-sm text-on-surface-variant">
              Every event each run recorded, in order. Offsets are measured from the start of that run.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {[baseline, fault].map((execution) =>
                execution ? (
                  <div key={execution.id} className={cn("rounded-xl border-t-4 bg-surface-low p-5", ROLE_STYLE[execution.role].border)}>
                    <h3 className={cn("type-title mb-2", ROLE_STYLE[execution.role].text)}>
                      {EXECUTION_ROLE_LABELS[execution.role]} <span className="text-sm font-normal text-on-surface-variant">({execution.events.length} events)</span>
                    </h3>
                    <EvidenceTimeline events={execution.events} />
                  </div>
                ) : null,
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
