import { CheckSquare, Footprints, Pencil, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeStep, findAllowlistMatch, isAssertionStep, STEP_TYPE_LABELS } from "@faultline/shared";
import { BackLink } from "@/design/components/back-link";
import { PageHeader } from "@/design/components/page-header";
import { ScanStatusChip } from "@/design/components/status";
import { requireOperator } from "@/lib/auth/dal";
import { getJourney } from "@/lib/data/analysis";
import { getEnv } from "@/lib/env";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { LinkButton } from "@/design/components";

export const metadata: Metadata = { title: "Journey" };

export default async function JourneyPage({ params }: { params: Promise<{ projectId: string; journeyId: string }> }) {
  await requireOperator();
  const { projectId, journeyId } = await params;
  const detail = await getJourney(journeyId);
  if (!detail || detail.project.id !== projectId) notFound();
  const { journey, project } = detail;
  const def = journey.definition;
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  const isLatest = journey.version === detail.latestVersion;
  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}/journeys`}>Journeys</BackLink>}
        title={def.name}
        description={
          <span className="flex flex-col gap-1">
            <span>
              Version {journey.version}
              {isLatest ? " (latest)" : ` of ${detail.latestVersion}`} · saved {formatDateTime(journey.createdAt)}
            </span>
            {def.description ? <span>{def.description}</span> : null}
          </span>
        }
        actions={
          authorized ? (
            <>
              <LinkButton href={`/projects/${project.id}/journeys/${journey.id}/edit`} variant="outlined" icon={<Pencil aria-hidden />}>
                Edit
              </LinkButton>
              {isLatest ? (
                <LinkButton href={`/projects/${project.id}/blast-radius/new?journey=${journey.id}`} icon={<Zap aria-hidden />}>
                  Analyze blast radius
                </LinkButton>
              ) : null}
            </>
          ) : null
        }
      />
      {!isLatest ? (
        <p className="mb-6 rounded-md border border-dashed border-incomplete px-4 py-3 text-sm">
          You are viewing an older version.{" "}
          <Link className="text-primary underline-offset-4 hover:underline" href={`/projects/${project.id}/journeys/${detail.versions[0]!.id}`}>
            Open version {detail.latestVersion}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="steps-title">
          <h2 id="steps-title" className="type-headline mb-3 text-2xl">
            Steps
          </h2>
          <ol className="flex flex-col gap-2">
            {def.steps.map((step, i) => {
              const assertion = isAssertionStep(step);
              const Icon = assertion ? CheckSquare : Footprints;
              return (
                <li key={i} className="flex gap-3 rounded-lg bg-surface-low px-4 py-3">
                  <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-surface-highest text-sm">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="break-words">{describeStep(step)}</p>
                    <p className="flex flex-wrap items-center gap-x-3 text-sm text-on-surface-variant">
                      <span className={cn("inline-flex items-center gap-1", assertion && "text-primary")}>
                        <Icon aria-hidden className="size-4" />
                        {STEP_TYPE_LABELS[step.type]}
                      </span>
                      {"maxDurationMs" in step && step.maxDurationMs ? <span>Budget {formatDuration(step.maxDurationMs)}</span> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {def.offlineExpectations.length ? (
            <>
              <h3 className="type-title mt-6 mb-2">Offline expectations</h3>
              <ul className="flex flex-col gap-2">
                {def.offlineExpectations.map((step, i) => (
                  <li key={i} className="rounded-lg bg-surface-low px-4 py-3">
                    {describeStep(step)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <aside className="flex flex-col gap-6">
          <section className="rounded-xl bg-surface-low p-5">
            <h2 className="type-title mb-2">Settings</h2>
            <dl className="grid gap-1 text-sm">
              <dt className="text-on-surface-variant">Whole-journey budget</dt>
              <dd>{def.performance.maxJourneyMs ? formatDuration(def.performance.maxJourneyMs) : "None"}</dd>
              <dt className="mt-2 text-on-surface-variant">Allowed data-changing requests</dt>
              <dd>{def.allowedMutations.length ? def.allowedMutations.map((m) => `${m.method} ${m.path}`).join(", ") : "None (all blocked)"}</dd>
              <dt className="mt-2 text-on-surface-variant">Screenshot masks</dt>
              <dd className="break-all">{def.maskSelectors.length ? def.maskSelectors.join(", ") : "None"}</dd>
            </dl>
          </section>
          <section className="rounded-xl bg-surface-low p-5">
            <h2 className="type-title mb-2">Versions</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.versions.map((v) => (
                <li key={v.id}>
                  {v.id === journey.id ? (
                    <span className="font-medium">Version {v.version} (viewing)</span>
                  ) : (
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/projects/${project.id}/journeys/${v.id}`}>
                      Version {v.version}
                    </Link>
                  )}{" "}
                  <span className="text-on-surface-variant">· {formatDateTime(v.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl bg-surface-low p-5">
            <h2 className="type-title mb-2">Analyses</h2>
            {detail.analyses.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No analysis has run this journey yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {detail.analyses.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/scans/${a.id}/blast-radius`}>
                      {formatDateTime(a.createdAt)}
                    </Link>
                    <span className="text-on-surface-variant">v{a.version}</span>
                    <ScanStatusChip status={a.status} className="h-6 text-xs" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
