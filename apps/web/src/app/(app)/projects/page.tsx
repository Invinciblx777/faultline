import { ChevronRight, FolderPlus, Globe, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListGroup } from "@/design/components";
import { requireOperator } from "@/lib/auth/dal";
import { listProjects } from "@/lib/data/queries";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requireOperator();
  const projects = await listProjects();
  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is one website origin you are authorized to test."
        actions={
          projects.length ? (
            <LinkButton href="/projects/new" icon={<Plus aria-hidden />}>
              New project
            </LinkButton>
          ) : null
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="Create your first project"
          action={
            <LinkButton href="/projects/new" icon={<Plus aria-hidden />}>
              New project
            </LinkButton>
          }
        >
          A project points FAULTLINE at one origin from the server allowlist, such as <span className="text-on-surface">https://staging.example.com</span>.
          Scans and their evidence are stored under it.
        </EmptyState>
      ) : (
        <ListGroup>
          {projects.map((project) => (
            <li key={project.id} className="overflow-hidden">
              <Link
                href={`/projects/${project.id}`}
                className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 bg-surface-container px-5 py-4 transition-colors hover:bg-surface-high sm:grid-cols-[auto_1fr_auto_auto]"
              >
                <span className="row-span-2 grid size-12 place-items-center rounded-full bg-primary-container text-on-primary-container sm:row-span-1">
                  <Globe aria-hidden className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="md-label-medium block truncate text-on-surface-variant">
                    {project.origin} · last scan {formatRelative(project.lastScanAt)}
                  </span>
                  <span className="md-title-large block truncate">{project.name}</span>
                </span>
                <span className="md-label-medium col-start-2 text-on-surface-variant sm:col-start-3 sm:text-right">
                  <span className="tabular">{project.scanCount}</span> {project.scanCount === 1 ? "scan" : "scans"}
                </span>
                <ChevronRight aria-hidden className="col-start-3 row-span-2 row-start-1 size-5 text-on-surface-variant sm:col-start-4 sm:row-span-1" />
              </Link>
            </li>
          ))}
        </ListGroup>
      )}
    </>
  );
}
