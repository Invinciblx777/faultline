import { Bot, Download, ExternalLink, FileCode, GitPullRequest, MessageSquareQuote, MessageSquareText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { describeFault, healthyScreenshotsIdentical, REPAIR_VERIFIABLE_STATUSES, verdictScope, type RepairEvidenceBundle } from "@faultline/shared";
import { ApproveRepairForm, CancelQueuedButton, CheckRepairAccessButton, CrossCheckForm, PostVerdictCommentButton, RefreshRepairButton, VerifyButton } from "@/components/repair/repair-actions";
import { RepairLive } from "@/components/repair/repair-live";
import { RepairStatusChip, VERIFICATION_STYLE, VerificationVerdictChip } from "@/components/repair/repair-status";
import { RepairStepper, repairSteps } from "@/components/repair/repair-stepper";
import { VerificationWorkspace } from "@/components/repair/verification-workspace";
import { BackLink } from "@/design/components/back-link";
import { PageHeader } from "@/design/components/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getRepair, getRepairStatus, type RepairDetail } from "@/lib/data/repairs";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getDevinConfig } from "@/lib/integrations";
import { APPROVAL_STATEMENT, repositoryAccessBlock } from "@/lib/services/repairs";
import { cn } from "@/lib/cn";
import { Card, CardDescription, CardTitle, DisplayNumeral, ExpressiveShape, ListGroup, NotificationCard } from "@/design/components";

export const metadata: Metadata = { title: "Repair" };

const SOURCE_LABELS = { faultline: "FAULTLINE", operator: "Operator", devin: "Devin", github: "GitHub", verification: "Verification" } as const;

function EvidencePanel({ evidence, sha, promptSha, prompt }: { evidence: RepairEvidenceBundle; sha: string; promptSha: string; prompt: string }) {
  return (
    <Card tier="low">
      <CardTitle>Evidence package</CardTitle>
      <CardDescription className="mb-4">
        Built from stored analysis rows, with page text sanitized and credentials removed. Checksum <span className="font-mono break-all text-on-surface">{sha}</span>.
      </CardDescription>
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
            <dt className="text-on-surface-variant">Steps that did not pass under the fault</dt>
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
    </Card>
  );
}

function SessionPanel({ detail }: { detail: RepairDetail }) {
  const { repair } = detail;
  if (!repair.approvedAt && repair.status !== "cancelled") return null;
  return (
    <Card tier="low">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Devin session</CardTitle>
        {repair.devinSessionUrl ? (
          <a href={repair.devinSessionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4">
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
          {/* Devin reports 0 until usage is settled; a zero is not a usage figure, so link to the session instead. */}
          <dt className="text-on-surface-variant">Usage</dt>
          <dd>
            {repair.devinAcusConsumed ? (
              <span className="tabular">{repair.devinAcusConsumed} ACUs</span>
            ) : repair.devinSessionUrl ? (
              <a href={repair.devinSessionUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                See the session in Devin
              </a>
            ) : (
              "Not reported"
            )}
          </dd>
          <dt className="text-on-surface-variant">Last synced</dt>
          <dd>{repair.lastSyncedAt ? formatRelative(repair.lastSyncedAt) : "Not yet"}</dd>
        </dl>
      ) : (
        <CardDescription>{repair.statusDetail ?? "No session has been created."}</CardDescription>
      )}
      {repair.syncError ? <p className="mt-3 text-sm text-failure">Last sync failed: {repair.syncError}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {repair.devinSessionId && repair.status !== "cancelled" ? <RefreshRepairButton repairId={repair.id} /> : null}
        {repair.status === "queued" ? <CancelQueuedButton repairId={repair.id} /> : null}
      </div>
    </Card>
  );
}

function PullRequestPanel({ detail }: { detail: RepairDetail }) {
  const { repair } = detail;
  if (!repair.prUrl) return null;
  return (
    <Card tier="low">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="inline-flex items-center gap-2">
          <GitPullRequest aria-hidden className="size-5" /> Pull request #{repair.prNumber}
        </CardTitle>
        <a href={repair.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4">
          Open on GitHub <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
      <CardDescription className="mb-3">Facts below come from the GitHub API, not from Devin&apos;s message. FAULTLINE never merges this pull request.</CardDescription>
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
    </Card>
  );
}

function VerifiedReport({ detail, canComment }: { detail: RepairDetail; canComment: boolean }) {
  const { repair } = detail;
  if (!repair.verdict) return null;
  const style = VERIFICATION_STYLE[repair.verdict];
  const run = detail.runs.find((r) => r.id === repair.latestVerificationId);
  const commentIsCurrent = Boolean(repair.verdictCommentUrl && run && repair.verdictCommentRunId === run.id);
  // Counts come from the verdict-deciding checks of the run that produced this verdict.
  const verdictChecks = (stage: string) => (run?.checks ?? []).filter((c) => c.purpose === "verdict" && c.stage === stage);
  const originalFault = verdictChecks("original-fault");
  const candidateFault = verdictChecks("candidate-fault");
  const VerdictIcon = style.icon;
  // Every verdict on this commit, oldest first: the repair's own runs and cross-checks by other findings' tests.
  const history = [...detail.runs].filter((r) => r.verdict).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return (
    <Card tier="container" aria-labelledby="report-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="relative grid h-40 w-full shrink-0 place-items-center sm:w-72">
          <ExpressiveShape shape="blob" className={cn("absolute inset-0 h-full w-full", style.blob)} />
          <span className="relative flex flex-col items-center gap-1 px-6 text-center">
            <VerdictIcon aria-hidden className="size-8" />
            <span className="md-headline-medium">{style.label}</span>
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id="report-title" className="md-title-large">
            {repair.verdict === "verified_fixed" ? "Verified fix report" : "Verification report"}
          </h2>
          <div className="flex flex-wrap gap-6">
            {originalFault.length ? (
              <DisplayNumeral
                value={`${originalFault.filter((c) => c.status === "failed").length}/${originalFault.length}`}
                caption="original runs fail under the fault"
                tone="text-failure"
              />
            ) : null}
            {candidateFault.length ? (
              <DisplayNumeral
                value={`${candidateFault.filter((c) => c.status === "passed").length}/${candidateFault.length}`}
                caption="candidate runs pass under the fault"
                tone={style.text}
              />
            ) : null}
          </div>
          <p className="md-body-medium text-on-surface">{verdictScope(repair.verdict, healthyScreenshotsIdentical(run?.checks ?? []))}</p>
        </div>
      </div>

      {history.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h3 className="md-title-medium">Verdicts on this pull request, in order</h3>
          <ol className="flex flex-wrap items-center gap-2">
            {history.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="md-label-medium text-on-surface-variant">
                  v{i + 1} · {r.crossCheckExperimentId ? "cross-check" : "repair test"} · {r.candidateSha.slice(0, 7)}
                </span>
                <VerificationVerdictChip verdict={r.verdict!} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <dl className="md-body-medium grid gap-x-6 gap-y-1 sm:grid-cols-[minmax(12rem,auto)_1fr]">
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
        <ul className="md-body-medium flex list-disc flex-col gap-1 pl-5">
          {repair.verdictRationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {repair.prAgentLimitations.length ? (
        <figure className="rounded-lg bg-surface-high px-5 py-4">
          <figcaption className="md-label-medium mb-2 inline-flex items-center gap-1.5 text-on-surface-variant">
            <MessageSquareQuote aria-hidden className="size-4" /> Agent-stated limitation, quoted from pull request #{repair.prNumber}
          </figcaption>
          <blockquote className="md-body-medium flex flex-col gap-2 italic">
            {repair.prAgentLimitations.map((l, i) => (
              <p key={i}>&ldquo;{l}&rdquo;</p>
            ))}
          </blockquote>
        </figure>
      ) : null}

      <ListGroup className="overflow-hidden [&>li]:overflow-hidden">
        {repair.devinSessionUrl ? (
          <li>
            <NotificationCard tier="high" icon={<Bot aria-hidden />} source="Devin session" title={repair.devinSessionId ?? "Session"} body="Approved by a human click; FAULTLINE judges the result independently." href={repair.devinSessionUrl} />
          </li>
        ) : null}
        {repair.prUrl ? (
          <li>
            <NotificationCard tier="high" icon={<GitPullRequest aria-hidden />} source={`Pull request #${repair.prNumber}`} time={repair.prMerged ? "merged" : (repair.prState ?? undefined)} title={repair.prTitle ?? `#${repair.prNumber}`} href={repair.prUrl} />
          </li>
        ) : null}
        {commentIsCurrent && repair.verdictCommentUrl ? (
          <li>
            <NotificationCard tier="high" icon={<MessageSquareText aria-hidden />} source={`Verdict comment · pull request #${repair.prNumber}`} time={formatDateTime(repair.verdictCommentPostedAt)} title={`${style.label} posted on the pull request`} href={repair.verdictCommentUrl} />
          </li>
        ) : null}
      </ListGroup>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!commentIsCurrent && canComment && repair.prNumber && run ? <PostVerdictCommentButton repairId={repair.id} prNumber={repair.prNumber} /> : null}
        <a href={`/api/repairs/${repair.id}/verdict`} className="md-title-medium inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-6 text-on-secondary-container hover:brightness-110">
          <Download aria-hidden className="size-5" /> Verdict report (Markdown)
        </a>
      </div>
      {repair.prHeadSha && repair.verifiedSha && repair.prHeadSha !== repair.verifiedSha ? (
        <p className="md-body-medium font-medium text-tertiary">
          The pull request has moved to {repair.prHeadSha.slice(0, 12)} since verification. This verdict applies only to {repair.verifiedSha.slice(0, 12)}; verify again.
        </p>
      ) : null}
    </Card>
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
  // Cross-checks judge the same commit with another finding's test; they never stand in for the repair's own verification.
  const primaryRuns = detail.runs.filter((r) => !r.crossCheckExperimentId);
  const crossRuns = detail.runs.filter((r) => r.crossCheckExperimentId);
  const latestRun = primaryRuns[0] ?? null;
  const anyActive = detail.runs.some((r) => r.status === "queued" || r.status === "running");
  const findingLabel = (f: RepairDetail["crossCheckFindings"][number]) =>
    `${f.verdict?.toUpperCase() ?? "FINDING"} · ${describeFault(f.fault, f.dependencyLabel)} · journey "${f.journey?.definition.name ?? "unknown"}" v${f.journey?.version ?? "?"}`;
  const isApprover = env.FAULTLINE_REPAIR_APPROVERS.includes(operator.username.toLowerCase());
  const blockedReason = !devin.configured
    ? `Devin is not configured on this server: ${devin.reason} Approval is disabled; no session can be created.`
    : !isApprover
      ? `${operator.username} is not on FAULTLINE_REPAIR_APPROVERS, so this account cannot approve Devin sessions.`
      : repositoryAccessBlock(detail.repository, repair);
  const verifiable = (REPAIR_VERIFIABLE_STATUSES as readonly string[]).includes(repair.status) && Boolean(repair.prHeadSha) && !anyActive;
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

      {/* Reports carry full SHAs and archive names with no spaces; let them wrap anywhere so phones never scroll sideways. */}
      <div className="flex flex-col gap-4 wrap-anywhere">
        <VerifiedReport detail={detail} canComment={isApprover} />

        {repair.status === "awaiting_approval" ? (
          <Card tier="low" aria-labelledby="launch-title">
            <h2 id="launch-title" className="md-title-large mb-1">
              Launch a Devin repair session
            </h2>
            <CardDescription className="mb-4">
              Approving creates one Devin session that may push a branch and open a pull request in {repair.repoOwner}/{repair.repoName}. Devin credits are spent only after this approval.
              The server never creates sessions on page load or while polling.
            </CardDescription>
            <ApproveRepairForm
              repairId={repair.id}
              evidenceSha256={repair.evidenceSha256}
              statement={APPROVAL_STATEMENT}
              repository={`${repair.repoOwner}/${repair.repoName}@${repair.baseBranch}`}
              canApprove={!blockedReason}
              blockedReason={blockedReason}
            />
            {devin.configured ? (
              <div className="mt-4 flex flex-col gap-1">
                <CheckRepairAccessButton repairId={repair.id} />
                <p className="text-xs text-on-surface-variant">
                  {detail.repository.devinCheckedAt ? `Last checked ${formatRelative(detail.repository.devinCheckedAt)}. ` : ""}Confirms the key, the organization, and that Devin lists this exact repository. No session is created.
                </p>
              </div>
            ) : null}
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <SessionPanel detail={detail} />
          <PullRequestPanel detail={detail} />
        </div>

        {repair.prHeadSha ? (
          <Card tier="low" aria-labelledby="verify-title">
            <h2 id="verify-title" className="type-title mb-1 inline-flex items-center gap-2 text-lg">
              <ShieldCheck aria-hidden className="size-5" /> Independent verification
            </h2>
            <CardDescription className="mb-4">FAULTLINE decides the verdict from its own browser runs against the exact commit. Devin&apos;s own claims never count.</CardDescription>
            {verifiable ? <VerifyButton repairId={repair.id} sha={repair.prHeadSha} again={Boolean(latestRun)} /> : null}
            {latestRun ? (
              <div className="mt-6">
                <VerificationWorkspace run={latestRun} />
              </div>
            ) : null}
            {primaryRuns.length > 1 ? (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-primary">{primaryRuns.length - 1} earlier verification run(s)</summary>
                <div className="mt-4 flex flex-col gap-8">
                  {primaryRuns.slice(1).map((run) => (
                    <VerificationWorkspace key={run.id} run={run} />
                  ))}
                </div>
              </details>
            ) : null}
          </Card>
        ) : null}

        {repair.prHeadSha && (crossRuns.length || detail.crossCheckFindings.length) ? (
          <Card tier="low" aria-labelledby="cross-title">
            <h2 id="cross-title" className="type-title mb-1 inline-flex items-center gap-2 text-lg">
              <ShieldCheck aria-hidden className="size-5" /> Cross-checks
            </h2>
            <CardDescription className="mb-4">
              The same commit, judged by another finding&apos;s unchanged regression test and journey (for example a newer journey version with more assertions). Each cross-check has its own verdict and scope; it never replaces the verdict above.
            </CardDescription>
            {verifiable && detail.crossCheckFindings.length ? (
              <CrossCheckForm repairId={repair.id} sha={repair.prHeadSha} findings={detail.crossCheckFindings.map((f) => ({ experimentId: f.experimentId, label: findingLabel(f) }))} />
            ) : null}
            {crossRuns.map((run) => {
              const finding = detail.crossCheckFindings.find((f) => f.experimentId === run.crossCheckExperimentId);
              return (
                <div key={run.id} className="mt-6 rounded-xl bg-surface-container p-4 sm:p-5">
                  <p className="mb-3 text-sm font-medium break-words">
                    Judged by: {finding ? findingLabel(finding) : `finding ${run.crossCheckExperimentId?.slice(0, 8)}`} · test <span className="font-mono">{run.regressionTestSha256.slice(0, 16)}</span>
                  </p>
                  <VerificationWorkspace run={run} />
                </div>
              );
            })}
          </Card>
        ) : null}

        <EvidencePanel evidence={repair.evidence} sha={repair.evidenceSha256} promptSha={repair.promptSha256} prompt={repair.prompt} />

        {detail.originalShots.length ? (
          <Card tier="low">
            <CardTitle>Original analysis screenshots</CardTitle>
            <CardDescription className="mb-4">Recorded by the Blast Radius analysis that produced this finding.</CardDescription>
            <div className="grid gap-4 md:grid-cols-2">
              {detail.originalShots.map((s) => (
                <figure key={s.id} className="flex flex-col gap-2">
                  <figcaption className="text-sm">{s.role === "baseline" ? "Normal conditions" : "Under the fault"}</figcaption>
                  <a href={`/api/artifacts/${s.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-surface-container">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
                    <img src={`/api/artifacts/${s.id}`} alt={`Original analysis screenshot, ${s.role}`} width={s.width ?? undefined} height={s.height ?? undefined} className="h-auto w-full" loading="lazy" />
                  </a>
                </figure>
              ))}
            </div>
          </Card>
        ) : null}

        <Card tier="low" aria-labelledby="audit-title">
          <h2 id="audit-title" className="type-title mb-1 text-lg">
            Audit trail
          </h2>
          <CardDescription className="mb-4">Every recorded event, oldest first. Devin messages are shown as Devin wrote them and are not treated as verification.</CardDescription>
          <ol className="flex flex-col gap-2">
            {detail.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-md bg-surface-container px-4 py-3 text-sm sm:grid-cols-[9rem_7rem_minmax(0,1fr)]">
                <time dateTime={e.occurredAt.toISOString()} className="tabular text-xs text-on-surface-variant">
                  {formatDateTime(e.occurredAt)}
                </time>
                <span className="type-label text-xs text-on-surface-variant">{SOURCE_LABELS[e.source]}</span>
                <span className="whitespace-pre-line">{e.message}</span>
              </li>
            ))}
          </ol>
        </Card>

        <p className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <FileCode aria-hidden className="size-4" /> Repair {repair.id} · Devin tag <span className="font-mono">{repair.devinTag}</span>
        </p>
      </div>
    </>
  );
}
