import { ArrowRight, Wrench } from "lucide-react";
import Link from "next/link";
import { REPAIR_OPEN_STATUSES } from "@faultline/shared";
import { getProjectRepository, getRepairForExperiment } from "@/lib/data/repairs";
import { CreateRepairButton } from "./repair-actions";
import { RepairStatusChip } from "./repair-status";

/**
 * "Fix with Devin" on a finding. Only broken or degraded findings whose
 * regression test reproduces the failure qualify, because verification
 * depends on that test.
 */
export async function FixWithDevinPanel({ experimentId, projectId, verdict, testStatus }: { experimentId: string; projectId: string; verdict: string | null; testStatus: string | null }) {
  const eligible = (verdict === "broken" || verdict === "degraded") && testStatus === "fails_as_expected";
  if (!eligible) return null;
  const [repo, repair] = await Promise.all([getProjectRepository(projectId), getRepairForExperiment(experimentId)]);
  const open = repair && (REPAIR_OPEN_STATUSES as readonly string[]).includes(repair.status);
  return (
    <section aria-labelledby="repair-title" className="mb-8 rounded-xl border border-outline-variant p-5 sm:p-6">
      <h2 id="repair-title" className="type-title mb-1 inline-flex items-center gap-2 text-lg">
        <Wrench aria-hidden className="size-5" /> Repair
      </h2>
      {repair ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <RepairStatusChip status={repair.status} />
            {repair.prNumber ? <span className="text-sm text-on-surface-variant">Pull request #{repair.prNumber}</span> : null}
          </div>
          <Link href={`/repairs/${repair.id}`} className="inline-flex w-fit items-center gap-1.5 text-primary underline underline-offset-4">
            Open repair <ArrowRight aria-hidden className="size-4" />
          </Link>
          {!open && repo ? <CreateRepairButton experimentId={experimentId} /> : null}
        </div>
      ) : repo ? (
        <div className="mt-3">
          <CreateRepairButton experimentId={experimentId} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-on-surface-variant">
          Link this project&apos;s source repository before asking Devin for a fix.{" "}
          <Link href={`/projects/${projectId}#source-repository`} className="text-primary underline underline-offset-4">
            Link a repository
          </Link>
        </p>
      )}
    </section>
  );
}
