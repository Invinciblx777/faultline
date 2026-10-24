import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOperator } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireOperator();
  const allowlist = getEnv().FAULTLINE_SCAN_ALLOWLIST.map((e) => ({ source: e.source, wildcard: e.wildcard }));
  return (
    <>
      <PageHeader title="New project" back={<BackLink href="/projects">Projects</BackLink>} />
      {allowlist.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No origins are authorized yet">
          Projects can only target origins on the server allowlist. Add the origins you control to{" "}
          <code className="font-mono text-sm text-on-surface">FAULTLINE_SCAN_ALLOWLIST</code> in the server&apos;s <code className="font-mono text-sm">.env</code>, then
          restart the web app and worker.
        </EmptyState>
      ) : (
        <ProjectForm allowlist={allowlist} />
      )}
    </>
  );
}
