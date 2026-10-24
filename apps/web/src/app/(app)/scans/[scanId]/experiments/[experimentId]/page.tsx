import { Download, FileCode, ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { describeFault, developmentEndpointNote, EXPERIMENT_KIND_LABELS, REPRODUCIBILITY_LABELS, VERDICT_DEFINITIONS } from "@faultline/shared";
import { CausalTimeline } from "@/components/analysis/causal-timeline";
import { ExperimentStateChip, KindLabel } from "@/components/analysis/verdict";
import { FixWithDevinPanel } from "@/components/repair/fix-with-devin";
import { RealitySplit, type SplitShot } from "@/components/scan/reality-split";
import { BackLink } from "@/design/components/back-link";
import { PageHeader } from "@/design/components/page-header";
import { ToneChip } from "@/design/components/status";
import { requireOperator } from "@/lib/auth/dal";
import { getExperimentDetail, type ExperimentDetail } from "@/lib/data/analysis";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { buttonStyle } from "@/design/components";

export const metadata: Metadata = { title: "Experiment" };

type Run = ExperimentDetail["attempts"][number];

function shot(run: Run | null, role: string, tone: "normal" | "fault", label: string): SplitShot {
  return {
    role,
    tone,
    label,
    outcomeLabel: null,
    artifactId: run?.screenshot?.id ?? null,
    width: run?.screenshot?.width ?? null,
    height: run?.screenshot?.height ?? null,
    sha256: run?.screenshot?.sha256 ?? null,
    missingReason: !run ? "This run did not happen." : run.failureMessage ? `No final screenshot: ${run.failureMessage}` : "No final screenshot was captured for this run.",
  };
}

const STEP_STATUS = {
  passed: { tone: "success", label: "Passed" },
  failed: { tone: "failure", label: "Failed" },
  not_reached: { tone: "unavailable", label: "Not reached" },
} as const;

function StepCell({ run, index }: { run: Run | null; index: number }) {
  const step = run?.steps.find((s) => s.phase === "journey" && s.stepIndex === index);
  if (!step) return <span className="text-on-surface-variant">No record</span>;
  const status = STEP_STATUS[step.status];
  const screenshot = run?.stepScreenshots.find((a) => a.stepIndex === index);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <ToneChip tone={status.tone} label={status.label} className="h-6 text-xs" />
        {step.durationMs !== null ? <span className="tabular text-xs text-on-surface-variant">{formatDuration(step.durationMs)}</span> : null}
      </span>
      {step.error ? <span className="text-xs break-words text-failure">{step.error}</span> : null}
      {screenshot ? (
        <a href={`/api/artifacts/${screenshot.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
          <ImageIcon aria-hidden className="size-3.5" /> Screenshot at failure
        </a>
      ) : null}
    </div>
  );
}

export default async function ExperimentPage({ params }: { params: Promise<{ scanId: string; experimentId: string }> }) {
  await requireOperator();
  const { scanId, experimentId } = await params;
  const detail = await getExperimentDetail(experimentId);
  if (!detail || detail.scan.id !== scanId) notFound();
  const { experiment, scan, baseline, attempts, regressionTest } = detail;
  const journey = scan.journeySnapshot?.definition;
  const first = attempts[0] ?? null;
  const second = attempts[1] ?? null;
  const analysis = scan.analysis;
  const title = experiment.dependencyLabel ?? EXPERIMENT_KIND_LABELS[experiment.kind];
  const note = developmentEndpointNote(experiment.dependencyKey, scan.targetUrl);
  const injected = first?.requests.filter((r) => r.injected && r.injected !== "mutation-blocked") ?? [];
  const natural = first?.requests.filter((r) => !r.injected && (r.outcome === "failed" || (r.status ?? 0) >= 400)) ?? [];
  const blocked = first?.requests.filter((r) => r.injected === "mutation-blocked") ?? [];
  const offlineChecks = first?.steps.filter((s) => s.phase === "offline-expectation") ?? [];

  return (
    <>
      <PageHeader
        back={<BackLink href={`/scans/${scan.id}/blast-radius`}>Blast Radius</BackLink>}
        title={<span className="break-all">{title}</span>}
        description={
          <span className="flex flex-col gap-2">
            <KindLabel kind={experiment.kind} />
            {note ? <span className="font-medium text-on-surface">{note}</span> : null}
            <span>{describeFault(experiment.fault, experiment.dependencyLabel)}.</span>
          </span>
        }
        actions={
          regressionTest ? (
            <a href={`/api/experiments/${experiment.id}/regression-test`} download className={buttonStyle("tonal")}>
              <Download aria-hidden />
              Download regression test
            </a>
          ) : null
        }
      />

      <section aria-labelledby="verdict-title" className="mb-8 rounded-xl bg-surface-low p-5 sm:p-6">
        <h2 id="verdict-title" className="sr-only">
          Verdict
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ExperimentStateChip status={experiment.status} verdict={experiment.verdict} />
          {experiment.reproducibility ? <span className="text-sm text-on-surface-variant">{REPRODUCIBILITY_LABELS[experiment.reproducibility]}</span> : null}
          {experiment.durationMs ? <span className="tabular text-sm text-on-surface-variant">{formatDuration(experiment.durationMs)} total</span> : null}
        </div>
        {experiment.verdict ? <p className="mb-3 text-sm text-on-surface-variant">{VERDICT_DEFINITIONS[experiment.verdict]}</p> : null}
        {experiment.reasons.length ? (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {experiment.reasons.map((r, i) => (
              <li key={i}>
                {r.message}
                {r.stepIndex !== undefined ? (
                  <a href={`#step-${r.stepIndex}`} className="ml-2 text-sm text-primary underline-offset-4 hover:underline">
                    step {r.stepIndex + 1}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {experiment.failureMessage && experiment.verdict === "test_failed" ? <p className="mt-2 text-sm text-failure">{experiment.failureMessage}</p> : null}
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-on-surface-variant">{experiment.kind === "offline" ? "Fault applied" : "Requests the fault acted on"}</dt>
            <dd className="tabular">
              {experiment.kind === "narrow-viewport"
                ? "Not applicable (layout condition)"
                : experiment.kind === "offline"
                  ? experiment.affectedRequestCount
                    ? "Browser switched offline after the first page loaded"
                    : "Never (the first page did not load)"
                  : experiment.affectedRequestCount}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">New natural request failures</dt>
            <dd className="tabular">{experiment.newFailedRequestCount}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">New console or page errors</dt>
            <dd className="tabular">{experiment.newErrors.length}</dd>
          </div>
        </dl>
      </section>

      <FixWithDevinPanel experimentId={experiment.id} projectId={scan.projectId} verdict={experiment.verdict} testStatus={regressionTest?.validationStatus ?? null} />

      <section aria-labelledby="split-title" className="mb-10">
        <h2 id="split-title" className="type-headline mb-1 text-2xl">
          Reality Split
        </h2>
        <p className="mb-4 text-sm text-on-surface-variant">
          Final screenshots of the baseline run and this experiment&apos;s first run, both captured after the journey ended (or stopped).{" "}
          {experiment.visual?.note ?? ""}
        </p>
        <RealitySplit
          shots={[shot(baseline, "baseline", "normal", "Baseline (normal)"), shot(first, "experiment", "fault", "Under fault")]}
          diff={first?.diff ? { artifactId: first.diff.id, width: first.diff.width, height: first.diff.height, note: experiment.visual?.note ?? "Changed pixels are highlighted." } : null}
        />
        {analysis?.visualThreshold ? (
          <p className="mt-3 text-sm text-on-surface-variant">
            Calibration: {analysis.calibration?.note} {analysis.visualThreshold.explanation}
          </p>
        ) : null}
      </section>

      {journey ? (
        <section aria-labelledby="steps-title" className="mb-10">
          <h2 id="steps-title" className="type-headline mb-1 text-2xl">
            Journey checks
          </h2>
          <p className="mb-4 text-sm text-on-surface-variant">Each step in the baseline run and under the fault. Only steps that passed in both normal runs count toward the verdict.</p>
          <div className="overflow-x-auto rounded-xl bg-surface-low">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Baseline</th>
                  <th className="px-4 py-3 font-medium">Under fault</th>
                  {second ? <th className="px-4 py-3 font-medium">Confirmation run</th> : null}
                </tr>
              </thead>
              <tbody>
                {journey.steps.map((step, i) => {
                  const affected = experiment.affectedSteps.includes(i);
                  const excluded = experiment.excludedSteps.find((s) => s.index === i);
                  return (
                    <tr key={i} id={`step-${i}`} className={cn("scroll-mt-24 border-t border-outline-variant align-top", affected && "bg-failure-container/20")}>
                      <td className="px-4 py-3">
                        <span className="tabular text-on-surface-variant">{i + 1}.</span> {first?.steps.find((s) => s.phase === "journey" && s.stepIndex === i)?.description ?? step.type}
                        {"maxDurationMs" in step && step.maxDurationMs ? <span className="block text-xs text-on-surface-variant">Budget {formatDuration(step.maxDurationMs)}</span> : null}
                        {excluded ? <span className="block text-xs text-incomplete">Excluded: {excluded.reason}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <StepCell run={baseline} index={i} />
                      </td>
                      <td className="px-4 py-3">
                        <StepCell run={first} index={i} />
                      </td>
                      {second ? (
                        <td className="px-4 py-3">
                          <StepCell run={second} index={i} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {offlineChecks.length ? (
            <div className="mt-4 rounded-xl bg-surface-low p-4">
              <h3 className="type-title mb-2">Offline expectations</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {offlineChecks.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <ToneChip tone={STEP_STATUS[c.status].tone} label={c.status === "passed" ? "Met" : c.status === "failed" ? "Not met" : "Not checked"} className="h-6 text-xs" />
                    {c.description}
                    {c.error ? <span className="text-xs text-failure">{c.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="network-title" className="mb-10">
        <h2 id="network-title" className="type-headline mb-1 text-2xl">
          Network evidence
        </h2>
        <p className="mb-4 text-sm text-on-surface-variant">
          From the first run under the fault. URLs are redacted; no headers, cookies, or bodies are stored. Injected entries were produced by FAULTLINE, not by the server.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-surface-low p-4">
            <h3 className="type-title mb-2">Requests the fault acted on ({injected.length})</h3>
            {injected.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                {experiment.kind === "offline" || experiment.kind === "narrow-viewport"
                  ? "This condition does not intercept individual requests."
                  : "None. A fault that never applies cannot support a verdict."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {injected.map((r) => (
                  <li key={r.id} id={`req-${first!.id}-${r.requestId}`} className="scroll-mt-24">
                    <span className="type-label mr-2 inline-flex rounded-sm bg-fault-container px-1.5 text-xs text-on-fault-container">
                      {r.injected === "aborted" ? "Aborted" : r.injected === "error-response" ? `Injected ${r.status}` : "Delayed"}
                    </span>
                    <span className="break-all">
                      #{r.requestId} {r.method} {r.url}
                    </span>
                    <span className="block text-xs text-on-surface-variant">
                      {r.resourceType} · {r.stepIndex !== null ? `during step ${r.stepIndex + 1}` : "before the first step completed"}
                      {r.durationMs !== null ? ` · ${formatDuration(r.durationMs)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl bg-surface-low p-4">
            <h3 className="type-title mb-2">Problems observed under the fault</h3>
            {natural.length === 0 && experiment.newErrors.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No natural request failures or new console/page errors compared with the baseline runs.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {experiment.newErrors.map((e, i) => (
                  <li key={`e${i}`}>
                    <span className="type-label mr-2 inline-flex rounded-sm bg-surface-highest px-1.5 text-xs">{e.kind === "page_error" ? "Page error" : e.kind === "console" ? "Console error" : "Request"}</span>
                    <span className="break-words">{e.message}</span>
                    <span className="block text-xs text-on-surface-variant">Not seen in either normal run</span>
                  </li>
                ))}
                {natural.map((r) => (
                  <li key={r.id} id={`req-${first!.id}-${r.requestId}`} className="scroll-mt-24">
                    <span className="type-label mr-2 inline-flex rounded-sm bg-surface-highest px-1.5 text-xs">{r.status ? `HTTP ${r.status}` : "Failed"}</span>
                    <span className="break-all">
                      #{r.requestId} {r.method} {r.url}
                    </span>
                    {r.failureText ? <span className="block text-xs text-on-surface-variant">{r.failureText}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {blocked.length ? (
              <p className="mt-3 text-xs text-on-surface-variant">
                {blocked.length} data-changing request{blocked.length === 1 ? " was" : "s were"} blocked by the safety policy (also blocked in the baseline). These are not faults.
              </p>
            ) : null}
          </div>
        </div>
        {first ? (
          <details className="mt-4 rounded-lg border border-outline-variant p-4">
            <summary className="cursor-pointer text-sm font-medium">All {first.requests.length} requests in this run</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-xs">
                <thead className="text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-1 font-medium">#</th>
                    <th className="px-2 py-1 font-medium">Request</th>
                    <th className="px-2 py-1 font-medium">Type</th>
                    <th className="px-2 py-1 font-medium">Result</th>
                    <th className="px-2 py-1 font-medium">Step</th>
                    <th className="px-2 py-1 font-medium">Start</th>
                    <th className="px-2 py-1 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {first.requests.map((r) => (
                    <tr key={r.id} className="border-t border-outline-variant">
                      <td className="tabular px-2 py-1">{r.requestId}</td>
                      <td className="px-2 py-1 break-all">
                        {r.method} {r.url}
                      </td>
                      <td className="px-2 py-1">{r.resourceType}</td>
                      <td className="px-2 py-1">
                        {r.injected ? (r.injected === "mutation-blocked" ? "Blocked (safety)" : `Injected (${r.injected})`) : r.status ? `HTTP ${r.status}` : r.outcome}
                      </td>
                      <td className="px-2 py-1">{r.stepIndex !== null ? r.stepIndex + 1 : "–"}</td>
                      <td className="tabular px-2 py-1">+{(r.startedOffsetMs / 1000).toFixed(2)} s</td>
                      <td className="tabular px-2 py-1">{formatDuration(r.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      {first ? (
        <section aria-labelledby="timeline-title" className="mb-10">
          <h2 id="timeline-title" className="type-headline mb-1 text-2xl">
            Causal evidence timeline
          </h2>
          <p className="mb-4 text-sm text-on-surface-variant">Everything recorded in the first run under the fault, on one clock from the start of the run.</p>
          <CausalTimeline attempt={first} baselineEvents={baseline?.events ?? []} />
        </section>
      ) : null}

      <section aria-labelledby="test-title" className="mb-10">
        <h2 id="test-title" className="type-headline mb-1 text-2xl">
          Regression test
        </h2>
        {regressionTest ? (
          <div className="rounded-xl bg-surface-low p-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <FileCode aria-hidden className="size-5 text-primary" />
              <span className="font-mono text-sm break-all">{regressionTest.filename}</span>
              <ToneChip
                tone={regressionTest.validationStatus === "fails_as_expected" ? "success" : regressionTest.validationStatus === "passes" ? "incomplete" : regressionTest.validationStatus === "error" ? "failure" : "neutral"}
                label={
                  regressionTest.validationStatus === "fails_as_expected"
                    ? "Validated: fails on the current site"
                    : regressionTest.validationStatus === "passes"
                      ? "Validated: passed (did not reproduce)"
                      : regressionTest.validationStatus === "error"
                        ? "Validation error"
                        : "Not validated"
                }
              />
            </div>
            {regressionTest.validationSummary ? <p className="mb-3 text-sm break-words">{regressionTest.validationSummary}</p> : null}
            {regressionTest.validatedAt ? <p className="mb-3 text-xs text-on-surface-variant">Run with Playwright Test at {formatDateTime(regressionTest.validatedAt)}.</p> : null}
            <p className="mb-2 text-sm text-on-surface-variant">Run it in a project with @playwright/test installed:</p>
            <pre className="mb-4 overflow-x-auto rounded-md bg-surface-container p-3 font-mono text-xs">{regressionTest.command}</pre>
            <details>
              <summary className="cursor-pointer text-sm font-medium">View source</summary>
              <pre className="mt-3 max-h-[60vh] overflow-auto rounded-md bg-surface-container p-3 font-mono text-xs">{regressionTest.content}</pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">
            Regression tests are generated only for BROKEN and DEGRADED findings. {experiment.verdict ? "This experiment's verdict does not call for one." : ""}
          </p>
        )}
      </section>
    </>
  );
}
