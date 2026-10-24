import { ExternalLink, FileCode, GitPullRequest, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REPAIR_VERIFIABLE_STATUSES, VERIFICATION_VERDICT_DEFINITIONS, type RepairEvidenceBundle } from "@faultline/shared";
import { ApproveRepairForm, CancelQueuedButton, RefreshRepairButton, VerifyButton } from "@/components/repair/repair-actions";
import { RepairLive } from "@/components/repair/repair-live";
import { RepairStatusChip, VERIFICATION_STYLE, VerificationVerdictChip } from "@/components/repair/repair-status";
import { RepairStepper, repairSteps } from "@/components/repair/repair-stepper";
import { VerificationWorkspace } from "@/components/repair/verification-workspace";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { Description, SectionTitle, Surface } from "@/components/ui/surface";
import { requireOperator } from "@/lib/auth/dal";
import { getRepair, getRepairStatus, type RepairDetail } from "@/lib/data/repairs";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getDevinConfig } from "@/lib/integrations";
import { APPROVAL_STATEMENT } from "@/lib/services/repairs";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Repair" };

const SOURCE_LABELS = { faultline: "FAULTLINE", operator: "Operator", devin: "Devin", github: "GitHub", verification: "Verification" } as const;

function EvidencePanel({ evidence, sha, promptSha, prompt }: { evidence: RepairEvidenceBundle; sha: string; promptSha: string; prompt: string }) {
  return (
    <Surface>
      <SectionTitle>Evidence package</SectionTitle>
      <Description className="mb-4">
        Built from stored analysis rows, with page text sanitized and credentials removed. Checksum <span className="font-mono break-all text-on-surface">{sha}</span>.
      </Description>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
        <dt className="text-on-surface-variant">Finding</dt>
        <dd>
          {evidence.finding.verdict} · {evidence.finding.fault}
        </dd>
        <dt className="text-on-surface-variant">Affected page</dt>
        <dd className="break-all">{evidence.finding.affectedPage}</dd>
        <dt className="text-on-surface-variant">Expected</dt>
        <dd>{evidence.expectedBehavior}</dd>
        <dt className="text-on-surface-variant">Observed</dt>
        <dd>{evidence.currentBehavior}</dd>
        {evidence.observations.failedAssertions.length ? (
          <>
            <dt className="text-on-surface-variant">Failed steps</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {evidence.observations.failedAssertions.map((a) => (
                  <li key={a.step}>
                    Step {a.step}: {a.description}
                    {a.error ? <span className="block text-xs break-words text-failure">{a.error}</span> : null}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
        <dt className="text-on-surface-variant">Regression test</dt>
        <dd className="break-all">
          {evidence.regressionTest.filename} · <span className="font-mono">{evidence.regressionTest.sha256.slice(0, 16)}</span> · {evidence.regressionTest.validationStatus.replace(/_/g, " ")}
        </dd>
        <dt className="text-on-surface-variant">Repository</dt>
        <dd className="break-all">
          {evidence.repository.fullName}@{evidence.repository.baseBranch} · <span className="font-mono">{evidence.repository.baseSha?.slice(0, 12) ?? "unresolved"}</span>
        </dd>
      </dl>
      {evidence.limitations.length ? (
        <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-sm text-on-surface-variant">
          {evidence.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-primary">Full prompt for Devin (SHA-256 {promptSha.slice(0, 16)}…)</summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md bg-surface-lowest p-3 font-mono text-xs whitespace-pre-wrap">{prompt}</pre>
      </details>
    </Surface>
  );
}

function SessionPanel({ detail }: { detail: RepairDetail }) {
  const { repair } = detail;
  if (!repair.approvedAt && repair.status !== "cancelled") return null;
  return (
    <Surface>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Devin session</SectionTitle>
        {repair.devinSessionUrl ? (
          <a href={repair.devinSessionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
            Open in Devin <ExternalLink aria-hidden className="size-4" />
          </a>
        ) : null}
      </div>
      {repair.devinSessionId ? (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
          <dt className="text-on-surface-variant">Session</dt>
          <dd className="font-mono break-all">{repair.devinSessionId}</dd>
          <dt className="text-on-surface-variant">Devin reports</dt>
          <dd>
            {repair.devinStatus ?? "unknown"}
            {repair.devinStatusDetail ? ` · ${repair.devinStatusDetail}` : ""}
          </dd>
          <dt className="text-on-surface-variant">Created</dt>
          <dd>{formatDateTime(repair.devinCreatedAt)}</dd>
          {repair.devinAcusConsumed !== null ? (
            <>
              <dt className="text-on-surface-variant">ACUs consumed</dt>
              <dd className="tabular">{repair.devinAcusConsumed}</dd>
            </>
          ) : null}
          <dt className="text-on-surface-variant">Last synced</dt>
          <dd>{repair.lastSyncedAt ? formatRelative(repair.lastSyncedAt) : "Not yet"}</dd>
        </dl>
      ) : (
        <Description>{repair.statusDetail ?? "No session has been created."}</Description>
      )}
      {repair.syncError ? <p className="mt-3 text-sm text-failure">Last sync failed: {repair.syncError}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {repair.devinSessionId && repair.status !== "cancelled" ? <RefreshRepairButton repairId={repair.id} /> : null}
        {repair.status === "queued" ? <CancelQueuedButton repairId={repair.id} /> : null}
      </div>
    </Surface>
  );
}

function PullRequestPanel({ detail }: { detail: RepairDetail }) {
  const { repair } = detail;
  if (!repair.prUrl) return null;
  return (
    <Surface>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="inline-flex items-center gap-2">
          <GitPullRequest aria-hidden className="size-5" /> Pull request #{repair.prNumber}
        </SectionTitle>
        <a href={repair.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
          Open on GitHub <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
      <Description className="mb-3">Facts below come from the GitHub API, not from Devin&apos;s message. FAULTLINE never merges this pull request.</Description>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
        <dt className="text-on-surface-variant">Title</dt>
        <dd className="break-words">{repair.prTitle}</dd>
        <dt className="text-on-surface-variant">State</dt>
        <dd>
          {repair.prMerged ? "merged" : repair.prState}
          {repair.prDraft ? " (draft)" : ""}
        </dd>
        <dt className="text-on-surface-variant">Branches</dt>
        <dd className="break-all">
          {repair.prHeadRef} → {repair.prBaseRef}
        </dd>
        <dt className="text-on-surface-variant">Head commit</dt>
        <dd className="font-mono break-all">{repair.prHeadSha}</dd>
        <dt className="text-on-surface-variant">Checked</dt>
        <dd>{formatRelative(repair.prCheckedAt)}</dd>
      </dl>
      {repair.prNotes?.length ? (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-on-surface-variant">
          {repair.prNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </Surface>
  );
}

function VerifiedReport({ detail }: { detail: RepairDetail }) {
  const { repair } = detail;
  if (!repair.verdict) return null;
  const style = VERIFICATION_STYLE[repair.verdict];
  const run = detail.runs.find((r) => r.id === repair.latestVerificationId);
  return (
    <section aria-labelledby="report-title" className={cn("rounded-xl border-2 p-5 sm:p-6", style.panel)}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="report-title" className="type-headline text-2xl">
          {repair.verdict === "verified_fixed" ? "Verified fix report" : "Verification report"}
        </h2>
        <VerificationVerdictChip verdict={repair.verdict} />
      </div>
      <p className="mb-3 text-sm">{VERIFICATION_VERDICT_DEFINITIONS[repair.verdict]}</p>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr]">
        <dt className="text-on-surface-variant">Finding</dt>
        <dd>
          {repair.evidence.finding.verdict} · {repair.evidence.finding.fault}
        </dd>
        <dt className="text-on-surface-variant">Repository</dt>
        <dd className="break-all">
          {repair.repoOwner}/{repair.repoName}
        </dd>
        <dt className="text-on-surface-variant">Original commit</dt>
        <dd className="font-mono break-all">{run?.originalSha ?? repair.baseSha}</dd>
        <dt className="text-on-surface-variant">Verified commit</dt>
        <dd className="font-mono break-all">{repair.verifiedSha}</dd>
        <dt className="text-on-surface-variant">Pull request</dt>
        <dd>{repair.prUrl ? <a className="text-primary underline-offset-4 hover:underline" href={repair.prUrl}>#{repair.prNumber}</a> : "none"}</dd>
        <dt className="text-on-surface-variant">Devin session</dt>
        <dd className="break-all">{repair.devinSessionUrl ?? "none"}</dd>
        <dt className="text-on-surface-variant">Regression test</dt>
        <dd className="break-all">
          {repair.evidence.regressionTest.filename} · <span className="font-mono">{repair.regressionTestSha256.slice(0, 16)}</span> (unchanged)
        </dd>
        <dt className="text-on-surface-variant">Approved by</dt>
        <dd>
          {repair.approvedByUsername} on {formatDateTime(repair.approvedAt)}
        </dd>
        <dt className="text-on-surface-variant">Decided</dt>
        <dd>{formatDateTime(repair.verdictAt)}</dd>
      </dl>
      {repair.verdictRationale?.length ? (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm">
          {repair.verdictRationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {repair.prHeadSha && repair.verifiedSha && repair.prHeadSha !== repair.verifiedSha ? (
        <p className="mt-3 text-sm font-medium text-incomplete">
          The pull request has moved to {repair.prHeadSha.slice(0, 12)} since verification. This verdict applies only to {repair.verifiedSha.slice(0, 12)}; verify again.
        </p>
      ) : null}
    </section>
  );
}

export default async function RepairPage({ params }: { params: Promise<{ repairId: string }> }) {
  const operator = await requireOperator();
  const { repairId } = await params;
  const [detail, live] = await Promise.all([getRepair(repairId), getRepairStatus(repairId)]);
  if (!detail || !live) notFound();
  const { repair, project, experiment } = detail;
  const env = getEnv();
  const devin = getDevinConfig();
  const latestRun = detail.runs[0] ?? null;
  const isApprover = env.FAULTLINE_REPAIR_APPROVERS.includes(operator.username.toLowerCase());
  const blockedReason = !devin.configured
    ? `Devin is not configured on this server: ${devin.reason} Approval is disabled; no session can be created.`
    : !isApprover
      ? `${operator.username} is not on FAULTLINE_REPAIR_APPROVERS, so this account cannot approve Devin sessions.`
      : null;
  const verifiable = (REPAIR_VERIFIABLE_STATUSES as readonly string[]).includes(repair.status) && Boolean(repair.prHeadSha) && latestRun?.status !== "queued" && latestRun?.status !== "running";
  const pollIntervalMs = Number(process.env.FAULTLINE_DEVIN_POLL_INTERVAL_MS) || 20_000;

  return (
    <>
      <PageHeader
        back={<BackLink href={`/scans/${repair.scanId}/experiments/${experiment.id}`}>Finding</BackLink>}
        title={<span className="break-words">Repair: {experiment.dependencyLabel ?? repair.evidence.finding.fault}</span>}
        description={
          <span className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <RepairStatusChip status={repair.status} />
              <span className="text-sm">
                {project.name} · {repair.repoOwner}/{repair.repoName}@{repair.baseBranch}
              </span>
            </span>
            {repair.statusDetail ? <span className="text-sm">{repair.statusDetail}</span> : null}
            <RepairLive
              repairId={repair.id}
              pollIntervalMs={pollIntervalMs}
              initial={{
                status: live.status,
                updatedAt: live.updatedAt.toISOString(),
                lastSyncedAt: live.lastSyncedAt?.toISOString() ?? null,
                syncError: live.syncError,
                events: live.events,
                verification: live.verification,
              }}
            />
          </span>
        }
      />

      <div className="mb-6 rounded-xl bg-surface-low p-2 sm:p-3">
        <RepairStepper steps={repairSteps(repair, latestRun)} />
      </div>

      <div className="flex flex-col gap-4">
        <VerifiedReport detail={detail} />

        {repair.status === "awaiting_approval" ? (
          <Surface level="container" aria-labelledby="launch-title">
            <h2 id="launch-title" className="type-title mb-1 text-lg">
              Launch a Devin repair session
            </h2>
            <Description className="mb-4">
              Approving creates one Devin session that may push a branch and open a pull request in {repair.repoOwner}/{repair.repoName}. Devin credits are spent only after this approval.
              The server never creates sessions on page load or while polling.
            </Description>
            <ApproveRepairForm
              repairId={repair.id}
              evidenceSha256={repair.evidenceSha256}
              statement={APPROVAL_STATEMENT}
              repository={`${repair.repoOwner}/${repair.repoName}@${repair.baseBranch}`}
              canApprove={!blockedReason}
              blockedReason={blockedReason}
            />
          </Surface>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <SessionPanel detail={detail} />
          <PullRequestPanel detail={detail} />
        </div>

        {repair.prHeadSha ? (
          <Surface aria-labelledby="verify-title">
            <h2 id="verify-title" className="type-title mb-1 inline-flex items-center gap-2 text-lg">
              <ShieldCheck aria-hidden className="size-5" /> Independent verification
            </h2>
            <Description className="mb-4">FAULTLINE decides the verdict from its own browser runs against the exact commit. Devin&apos;s own claims never count.</Description>
            {verifiable ? <VerifyButton repairId={repair.id} sha={repair.prHeadSha} again={Boolean(latestRun)} /> : null}
            {latestRun ? (
              <div className="mt-6">
                <VerificationWorkspace run={latestRun} />
              </div>
            ) : null}
            {detail.runs.length > 1 ? (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-primary">{detail.runs.length - 1} earlier verification run(s)</summary>
                <div className="mt-4 flex flex-col gap-8">
                  {detail.runs.slice(1).map((run) => (
                    <VerificationWorkspace key={run.id} run={run} />
                  ))}
                </div>
              </details>
            ) : null}
          </Surface>
        ) : null}

        <EvidencePanel evidence={repair.evidence} sha={repair.evidenceSha256} promptSha={repair.promptSha256} prompt={repair.prompt} />

        {detail.originalShots.length ? (
          <Surface>
            <SectionTitle>Original analysis screenshots</SectionTitle>
            <Description className="mb-4">Recorded by the Blast Radius analysis that produced this finding.</Description>
            <div className="grid gap-4 md:grid-cols-2">
              {detail.originalShots.map((s) => (
                <figure key={s.id} className="flex flex-col gap-2">
                  <figcaption className="text-sm">{s.role === "baseline" ? "Normal conditions" : "Under the fault"}</figcaption>
                  <a href={`/api/artifacts/${s.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-outline-variant">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
                    <img src={`/api/artifacts/${s.id}`} alt={`Original analysis screenshot, ${s.role}`} width={s.width ?? undefined} height={s.height ?? undefined} className="h-auto w-full" loading="lazy" />
                  </a>
                </figure>
              ))}
            </div>
          </Surface>
        ) : null}

        <Surface aria-labelledby="audit-title">
          <h2 id="audit-title" className="type-title mb-1 text-lg">
            Audit trail
          </h2>
          <Description className="mb-4">Every recorded event, oldest first. Devin messages are shown as Devin wrote them and are not treated as verification.</Description>
          <ol className="flex flex-col gap-2">
            {detail.events.map((e) => (
              <li key={e.id} className="grid gap-1 rounded-md bg-surface-container px-4 py-3 text-sm sm:grid-cols-[9rem_7rem_1fr]">
                <time dateTime={e.occurredAt.toISOString()} className="tabular text-xs text-on-surface-variant">
                  {formatDateTime(e.occurredAt)}
                </time>
                <span className="type-label text-xs text-on-surface-variant">{SOURCE_LABELS[e.source]}</span>
                <span className="break-words whitespace-pre-line">{e.message}</span>
              </li>
            ))}
          </ol>
        </Surface>

        <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <FileCode aria-hidden className="size-4" /> Repair {repair.id} · Devin tag <span className="font-mono">{repair.devinTag}</span>
        </p>
      </div>
    </>
  );
}
