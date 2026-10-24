import { History } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScanFilters } from "@/components/scan/scan-filters";
import { ScanList } from "@/components/scan/scan-list";
import { BackLink } from "@/design/components/back-link";
import { EmptyState } from "@/design/components/empty-state";
import { PageHeader } from "@/design/components/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getProject, listScans, normalizeFilters } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Scan history" };

export default async function ProjectHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const project = await getProject((await params).projectId);
  if (!project) notFound();
  const filters = normalizeFilters(await searchParams);
  const scans = await listScans({ ...filters, projectId: project.id, limit: 200 });
  const filtered = Boolean(filters.q || filters.status || filters.scenario);
  return (
    <>
      <PageHeader back={<BackLink href={`/projects/${project.id}`}>{project.name}</BackLink>} title="Scan history" description={project.origin} />
      <ScanFilters filters={filters} action={`/projects/${project.id}/history`} />
      {scans.length === 0 ? (
        <EmptyState icon={History} title={filtered ? "No scans match these filters" : "No scans yet"}>
          {filtered ? "Clear the filters to see every scan for this project." : "Scans you run for this project appear here with their status and duration."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-on-surface-variant" aria-live="polite">
            Showing <span className="tabular">{scans.length}</span> {scans.length === 1 ? "scan" : "scans"}
            {scans.length === 200 ? " (most recent 200)" : ""}
          </p>
          <ScanList scans={scans} />
        </>
      )}
    </>
  );
}
