import { Route, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { dependencies, scans } from "@faultline/db";
import { findAllowlistMatch, isAssertionStep } from "@faultline/shared";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/components/ui/back-link";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { listJourneys } from "@/lib/data/analysis";
import { getProject } from "@/lib/data/queries";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { AnalysisForm, type TargetOption } from "./analysis-form";

export const metadata: Metadata = { title: "New Blast Radius analysis" };

export default async function NewAnalysisPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ journey?: string }> }) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const { journey } = await searchParams;
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  const journeys = await listJourneys(project.id);

  // Dependencies observed by the latest completed analysis, offered as explicit targets.
  const db = getDb();
  const [last] = await db
    .select({ id: scans.id, finishedAt: scans.finishedAt })
    .from(scans)
    .where(and(eq(scans.projectId, project.id), eq(scans.scenarioKind, "blast-radius"), eq(scans.status, "completed")))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  const targets: TargetOption[] = last
    ? (await db.select().from(dependencies).where(eq(dependencies.scanId, last.id)))
        .filter((d) => d.eligibleFaults.length)
        .map((d) => ({ dependencyKey: d.key, label: d.label, eligibleFaults: d.eligibleFaults }))
    : [];

  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>}
        title="Blast Radius analysis"
        description="Runs the journey twice under normal conditions, discovers the dependencies it uses, then breaks one dependency or condition at a time and records which steps fail."
      />
      <WorkerNotice />
      {!authorized ? (
        <EmptyState icon={ShieldX} title="This origin is not authorized">
          {project.origin} is not on the server&apos;s scan allowlist.
        </EmptyState>
      ) : journeys.length === 0 ? (
        <EmptyState
          icon={Route}
          title="Create a journey first"
          action={
            <LinkButton href={`/projects/${project.id}/journeys/new`} icon={<Route aria-hidden />}>
              New journey
            </LinkButton>
          }
        >
          An analysis replays a saved journey. Its assertions decide whether a fault breaks the flow.
        </EmptyState>
      ) : (
        <AnalysisForm
          projectId={project.id}
          journeys={journeys.map((j) => ({ id: j.id, name: j.name, version: j.version, steps: j.definition.steps.length, assertions: j.definition.steps.filter(isAssertionStep).length }))}
          initialJourneyId={journeys.find((j) => j.id === journey || j.lineageId === journey)?.id ?? null}
          targets={targets}
          targetsFrom={last?.finishedAt ? formatDateTime(last.finishedAt) : null}
        />
      )}
    </>
  );
}
