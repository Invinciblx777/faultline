import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RepairStatusChip } from "@/components/repair/repair-status";
import { EmptyState } from "@/design/components/empty-state";
import { PageHeader } from "@/design/components/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { listRepairs } from "@/lib/data/repairs";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Repairs" };

export default async function RepairsPage() {
  await requireOperator();
  const repairs = await listRepairs();
  return (
    <>
      <PageHeader title="Repairs" description="Devin repair requests created from findings, and FAULTLINE's independent verification of each pull request." />
      {repairs.length === 0 ? (
        <EmptyState icon={Wrench} title="No repair requests">
          Open a broken finding and choose <span className="text-on-surface">Fix with Devin</span>. The project needs a linked source repository first.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {repairs.map((r) => (
            <li key={r.id}>
              <Link href={`/repairs/${r.id}`} className="flex flex-col gap-2 rounded-lg bg-surface-low px-5 py-4 transition-colors hover:bg-surface-container sm:flex-row sm:items-center sm:gap-4">
                <RepairStatusChip status={r.status} className="w-fit" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{r.fault}</span>
                  <span className="block text-sm text-on-surface-variant">
                    {r.projectName} · {r.repoOwner}/{r.repoName}
                    {r.prNumber ? ` · PR #${r.prNumber}` : ""}
                    {r.verifiedSha ? ` · verified ${r.verifiedSha.slice(0, 12)}` : ""}
                  </span>
                </span>
                <span className="text-sm text-on-surface-variant">updated {formatRelative(r.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
