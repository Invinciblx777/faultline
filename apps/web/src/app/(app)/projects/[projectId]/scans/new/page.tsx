import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findAllowlistMatch } from "@faultline/shared";
import { WorkerNotice } from "@/components/scan/worker-notice";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getProject } from "@/lib/data/queries";
import { getEnv } from "@/lib/env";
import { ScanForm } from "./scan-form";

export const metadata: Metadata = { title: "New scan" };

export default async function NewScanPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const authorized = Boolean(findAllowlistMatch(project.origin, getEnv().FAULTLINE_SCAN_ALLOWLIST));
  return (
    <>
      <PageHeader
        back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>}
        title="New scan"
        description="FAULTLINE loads the page under normal conditions, then again in a fresh browser context under the fault you choose."
      />
      <WorkerNotice />
      {authorized ? (
        <ScanForm projectId={project.id} origin={project.origin} />
      ) : (
        <EmptyState icon={ShieldX} title="This origin is not authorized">
          {project.origin} is no longer on the server&apos;s scan allowlist, so it cannot be scanned.
        </EmptyState>
      )}
    </>
  );
}
