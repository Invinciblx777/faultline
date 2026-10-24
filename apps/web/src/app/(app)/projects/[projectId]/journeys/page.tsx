import { Plus, Route } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findAllowlistMatch, isAssertionStep } from "@faultline/shared";
import { BackLink } from "@/components/ui/back-link";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { listJourneys } from "@/lib/data/analysis";
import { getProject } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Journeys" };

export default async function JourneysPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const journeys = await listJourneys(project.id);
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>}
        title="Journeys"
        description="Declarative user flows that a Blast Radius analysis replays under each fault. Every edit is saved as a new version; analyses keep the version they ran."
        actions={
          authorized ? (
            <LinkButton href={`/projects/${project.id}/journeys/new`} icon={<Plus aria-hidden />}>
              New journey
            </LinkButton>
          ) : null
        }
      />
      {journeys.length === 0 ? (
        <EmptyState icon={Route} title="No journeys yet">
          Describe a flow such as &ldquo;open the shop, add an item, get a shipping quote&rdquo; with steps and assertions. FAULTLINE replays it in Chromium.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {journeys.map((j) => {
            const assertions = j.definition.steps.filter(isAssertionStep).length;
            return (
              <li key={j.id}>
                <Link href={`/projects/${project.id}/journeys/${j.id}`} className="flex flex-col gap-1 rounded-lg bg-surface-low px-5 py-4 transition-colors hover:bg-surface-container">
                  <span className="type-title">{j.name}</span>
                  <span className="text-sm text-on-surface-variant">
                    Version {j.version} · {j.definition.steps.length} steps · {assertions} assertion{assertions === 1 ? "" : "s"} · updated {formatRelative(j.createdAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
