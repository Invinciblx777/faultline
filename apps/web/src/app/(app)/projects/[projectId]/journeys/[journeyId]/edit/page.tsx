import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JourneyBuilder } from "@/components/analysis/journey-builder";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getJourney } from "@/lib/data/analysis";

export const metadata: Metadata = { title: "Edit journey" };

export default async function EditJourneyPage({ params }: { params: Promise<{ projectId: string; journeyId: string }> }) {
  await requireOperator();
  const { projectId, journeyId } = await params;
  const detail = await getJourney(journeyId);
  if (!detail || detail.project.id !== projectId) notFound();
  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${projectId}/journeys/${journeyId}`}>{detail.journey.name}</BackLink>}
        title="Edit journey"
        description={`Editing version ${detail.journey.version}. Saving creates version ${detail.latestVersion + 1}; earlier versions and the analyses that used them are unchanged.`}
      />
      <JourneyBuilder projectId={projectId} journeyId={journeyId} initial={detail.journey.definition} />
    </>
  );
}
