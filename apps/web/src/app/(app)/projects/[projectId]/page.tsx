import { History, Radar, Route, ShieldCheck, ShieldX, Zap } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findAllowlistMatch } from "@faultline/shared";
import { SourceRepositoryCard } from "@/components/repair/source-repository";
import { ScanList } from "@/components/scan/scan-list";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/components/ui/back-link";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getProject, listScans } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const project = await getProject((await params).projectId);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({ params }: Params) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const recent = await listScans({ projectId: project.id, limit: 6 });
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  return (
    <>
      <PageHeader
        back={<BackLink href="/projects">Projects</BackLink>}
        title={project.name}
        description={
          <span className="flex flex-col gap-2">
            <span className="text-on-surface">{project.origin}</span>
            {project.description ? <span>{project.description}</span> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/projects/${project.id}/history`} variant="outlined" icon={<History aria-hidden />}>
              History
            </LinkButton>
            <LinkButton href={`/projects/${project.id}/journeys`} variant="outlined" icon={<Route aria-hidden />}>
              Journeys
            </LinkButton>
            {authorized ? (
              <>
                <LinkButton href={`/projects/${project.id}/scans/new`} variant="tonal" icon={<Radar aria-hidden />}>
                  New scan
                </LinkButton>
                <LinkButton href={`/projects/${project.id}/blast-radius/new`} icon={<Zap aria-hidden />}>
                  Blast Radius
                </LinkButton>
              </>
            ) : null}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-on-surface-variant">
        {authorized ? (
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden className="size-4 text-success" /> Origin is on the scan allowlist
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-failure">
            <ShieldX aria-hidden className="size-4" /> Origin is no longer on the scan allowlist; new scans are disabled
          </span>
        )}
        <span>Created {formatDateTime(project.createdAt)}</span>
      </div>
      <WorkerNotice />
      <SourceRepositoryCard projectId={project.id} />
      <h2 className="type-headline mb-4 text-2xl">Recent scans</h2>
      {recent.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No scans yet"
          action={
            authorized ? (
              <LinkButton href={`/projects/${project.id}/scans/new`} icon={<Radar aria-hidden />}>
                Run the first scan
              </LinkButton>
            ) : undefined
          }
        >
          A scan loads a page twice in Chromium, once normally and once under a fault you choose, and records what each run observed.
        </EmptyState>
      ) : (
        <ScanList scans={recent} />
      )}
    </>
  );
}
