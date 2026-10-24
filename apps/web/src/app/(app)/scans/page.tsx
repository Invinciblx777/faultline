import { History } from "lucide-react";
import type { Metadata } from "next";
import { ScanFilters } from "@/components/scan/scan-filters";
import { ScanList } from "@/components/scan/scan-list";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { listScans, normalizeFilters } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Scans" };

export default async function ScansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const filters = normalizeFilters(await searchParams);
  const scans = await listScans({ ...filters, limit: 200 });
  const filtered = Boolean(filters.q || filters.status || filters.scenario);
  return (
    <>
      <PageHeader title="Scans" description="Every scan across all projects, newest first." />
      <ScanFilters filters={filters} action="/scans" />
      {scans.length === 0 ? (
        <EmptyState icon={History} title={filtered ? "No scans match these filters" : "No scans yet"}>
          {filtered ? "Clear the filters to see every scan." : "Open a project and start a scan. Its live progress and evidence will appear here."}
        </EmptyState>
      ) : (
        <ScanList scans={scans} showProject />
      )}
    </>
  );
}
