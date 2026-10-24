import { ImageOff } from "lucide-react";
import type { VerificationCheck, VerificationRun } from "@faultline/db";
import { ToneChip } from "@/components/ui/status";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { VerificationVerdictChip } from "./repair-status";

type Run = VerificationRun & { checks: VerificationCheck[] };

const STAGE_LABELS: Record<VerificationCheck["stage"], string> = {
  "original-normal": "Original build, normal conditions",
  "original-fault": "Original build, under the fault",
  "original-fault-evidence": "Original build, under the fault (evidence run)",
  "candidate-fault": "Candidate build, under the fault",
  "candidate-fault-evidence": "Candidate build, under the fault (evidence run)",
  "candidate-normal": "Candidate build, normal conditions",
};

const CHECK_TONE = {
  passed: { tone: "success", label: "Passed" },
  failed: { tone: "failure", label: "Failed" },
  error: { tone: "incomplete", label: "Could not run" },
  skipped: { tone: "unavailable", label: "Skipped" },
  running: { tone: "running", label: "Running" },
} as const;

function checkTone(status: string) {
  return CHECK_TONE[status as keyof typeof CHECK_TONE] ?? { tone: "neutral" as const, label: status };
}

function Shot({ check, caption }: { check: VerificationCheck | undefined; caption: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{caption}</span>
        {check ? <ToneChip tone={checkTone(check.status).tone} label={checkTone(check.status).label} className="h-6 text-xs" /> : null}
      </figcaption>
      {check?.screenshotKey ? (
        <a href={`/api/verification-checks/${check.id}/screenshot`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-outline-variant bg-surface-lowest">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, immutable PNG served by our own route */}
          <img
            src={`/api/verification-checks/${check.id}/screenshot`}
            alt={`${caption}: final screenshot at ${check.targetOrigin}, commit ${check.sha.slice(0, 12)}`}
            width={check.screenshotWidth ?? undefined}
            height={check.screenshotHeight ?? undefined}
            className="h-auto w-full"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="grid aspect-[16/10] place-items-center rounded-lg border border-dashed border-outline-variant p-4 text-center text-sm text-on-surface-variant">
          <span className="flex flex-col items-center gap-2">
            <ImageOff aria-hidden className="size-6" />
            {check ? (check.status === "skipped" ? (check.summary ?? "This run was skipped.") : "No screenshot was captured for this run.") : "This run did not happen."}
          </span>
        </div>
      )}
      {check ? (
        <span className="text-xs break-all text-on-surface-variant">
          {check.targetOrigin} · <span className="font-mono">{check.sha.slice(0, 12)}</span>
          {check.screenshotSha256 ? (
            <>
              {" "}
              · png <span className="font-mono">{check.screenshotSha256.slice(0, 12)}</span>
            </>
          ) : null}
        </span>
      ) : null}
    </figure>
  );
}

function CheckRow({ check }: { check: VerificationCheck }) {
  const tone = checkTone(check.status);
  return (
    <li className="rounded-lg bg-surface-container p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="tabular text-sm text-on-surface-variant">#{check.ordinal}</span>
        <span className="font-medium">{STAGE_LABELS[check.stage]}</span>
        {check.purpose === "verdict" && check.stage.endsWith("fault") ? <span className="text-sm text-on-surface-variant">attempt {check.attempt}</span> : null}
        <ToneChip tone={tone.tone} label={tone.label} className="h-6 text-xs" />
        <span className="text-xs text-on-surface-variant">{check.method === "regression-test" ? "Unchanged regression test (Playwright Test)" : "Journey replay"}</span>
        {check.purpose === "evidence" ? <span className="text-xs text-on-surface-variant">evidence only, does not decide the verdict</span> : null}
        {check.durationMs !== null ? <span className="tabular ml-auto text-xs text-on-surface-variant">{formatDuration(check.durationMs)}</span> : null}
      </div>
      <p className="mt-1 text-xs break-all text-on-surface-variant">
        {check.targetOrigin} · commit <span className="font-mono">{check.sha}</span> · fault {check.faultApplied ? `applied${check.faultApplications !== null ? ` to ${check.faultApplications} request${check.faultApplications === 1 ? "" : "s"}` : ""}` : "not applied"}
      </p>
      {check.summary ? <p className={cn("mt-2 text-sm break-words", check.status === "failed" && "text-failure")}>{check.summary}</p> : null}
      {check.steps?.length ? (
        <ol className="mt-3 flex flex-col gap-1 text-sm">
          {check.steps.map((s) => (
            <li key={s.index} className="flex flex-wrap items-baseline gap-2">
              <span className="tabular w-6 text-on-surface-variant">{s.index + 1}.</span>
              <span className="min-w-0 flex-1 break-words">{s.description}</span>
              <ToneChip tone={s.status === "passed" ? "success" : s.status === "failed" ? "failure" : "unavailable"} label={s.status.replace("_", " ")} className="h-6 text-xs" />
              {s.error ? <span className="w-full pl-8 text-xs break-words text-failure">{s.error}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {check.errors?.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">
            {check.errors.length} console or page error{check.errors.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {check.errors.map((e, i) => (
              <li key={i} className="break-words">
                <span className="text-on-surface-variant">{e.kind}:</span> {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {check.output ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">Test runner output</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-lowest p-3 font-mono text-xs whitespace-pre-wrap">{check.output}</pre>
        </details>
      ) : null}
    </li>
  );
}

/** Before/after evidence and every recorded check of one verification run. */
export function VerificationWorkspace({ run }: { run: Run }) {
  const by = (stage: VerificationCheck["stage"]) => run.checks.find((c) => c.stage === stage);
  const builds = (run.builds ?? {}) as Record<string, { archiveSha256?: string; image?: string; origin?: string; container?: string } | undefined>;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {run.verdict ? <VerificationVerdictChip verdict={run.verdict} /> : <ToneChip tone={run.status === "running" || run.status === "queued" ? "running" : "incomplete"} label={run.status === "running" ? `Running${run.phase ? `: ${run.phase}` : ""}` : run.status} />}
        <span className="text-sm text-on-surface-variant">
          Requested {formatDateTime(run.createdAt)}
          {run.durationMs !== null ? ` · took ${formatDuration(run.durationMs)}` : ""}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-on-surface-variant">Original commit (base)</dt>
          <dd className="font-mono break-all">{run.originalSha}</dd>
        </div>
        <div>
          <dt className="text-on-surface-variant">Candidate commit (pull request #{run.prNumber} head)</dt>
          <dd className="font-mono break-all">{run.candidateSha}</dd>
        </div>
        <div>
          <dt className="text-on-surface-variant">Regression test SHA-256 (unchanged)</dt>
          <dd className="font-mono break-all">{run.regressionTestSha256}</dd>
        </div>
        {(["original", "candidate"] as const).map((label) =>
          builds[label] ? (
            <div key={label}>
              <dt className="text-on-surface-variant">{label === "original" ? "Original" : "Candidate"} build</dt>
              <dd className="break-all">
                {builds[label]?.origin} · archive <span className="font-mono">{builds[label]?.archiveSha256?.slice(0, 16)}</span>
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      {run.rationale?.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {run.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {run.errorMessage && !run.rationale?.length ? <p className="text-sm text-failure">{run.errorMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Shot check={by("original-fault-evidence")} caption="Before: original under the fault" />
        <Shot check={by("candidate-fault-evidence")} caption="After: candidate under the fault" />
        <Shot check={by("original-normal")} caption="Original, normal conditions" />
        <Shot check={by("candidate-normal")} caption="Candidate, normal conditions" />
      </div>

      {run.checks.length ? (
        <section aria-label="Verification checks">
          <h3 className="type-title mb-3 text-base">Every check, in order</h3>
          <ol className="flex flex-col gap-2">
            {run.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm text-on-surface-variant">No checks recorded yet.</p>
      )}
    </div>
  );
}
