import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findAllowlistMatch } from "@faultline/shared";
import { JourneyBuilder } from "@/components/analysis/journey-builder";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getProject } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "New journey" };

export default async function NewJourneyPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}/journeys`}>Journeys</BackLink>}
        title="New journey"
        description={
          <>
            Steps run on <span className="text-on-surface">{project.origin}</span> only. Journeys are data, not code: FAULTLINE never runs scripts you or the website provide.
          </>
        }
      />
      {authorized ? (
        <JourneyBuilder projectId={project.id} />
      ) : (
        <EmptyState icon={ShieldX} title="This origin is not authorized">
          {project.origin} is not on the server&apos;s scan allowlist.
        </EmptyState>
      )}
    </>
  );
}
