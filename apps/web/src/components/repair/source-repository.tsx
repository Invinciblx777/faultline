import { ExternalLink, FolderGit2 } from "lucide-react";
import { ToneChip } from "@/design/components/status";
import { getProjectRepository } from "@/lib/data/repairs";
import { getEnv } from "@/lib/env";
import { formatRelative } from "@/lib/format";
import { RecheckRepositoryButton } from "./repair-actions";
import { RepositoryForm } from "./repository-form";

const STATUS = {
  ok: { tone: "success", label: "Connected" },
  error: { tone: "failure", label: "Problem" },
  not_configured: { tone: "unavailable", label: "Not configured" },
  not_checked: { tone: "neutral", label: "Not checked" },
} as const;

export async function SourceRepositoryCard({ projectId }: { projectId: string }) {
  const repo = await getProjectRepository(projectId);
  const authorized = getEnv().FAULTLINE_REPAIR_REPOSITORIES;
  const defaults = {
    owner: repo?.owner ?? authorized[0]?.split("/")[0] ?? "",
    name: repo?.name ?? authorized[0]?.split("/")[1] ?? "",
    baseBranch: repo?.baseBranch ?? "main",
    appDir: repo?.appDir ?? "",
    entry: repo?.recipe.entry ?? "",
    portEnv: repo?.recipe.portEnv ?? "PORT",
    extraPortEnvs: repo?.recipe.extraPortEnvs.join(", ") ?? "",
    hostEnv: repo?.recipe.hostEnv ?? "",
  };
  return (
    <section id="source-repository" aria-labelledby="repo-title" className="mb-8 scroll-mt-24 rounded-xl bg-surface-low p-5 sm:p-6">
      <h2 id="repo-title" className="type-title mb-1 inline-flex items-center gap-2 text-lg">
        <FolderGit2 aria-hidden className="size-5" /> Source repository
      </h2>
      {repo ? (
        <div className="mt-3 flex flex-col gap-4">
          <a href={repo.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            {repo.owner}/{repo.name}@{repo.baseBranch} <ExternalLink aria-hidden className="size-4" />
          </a>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["GitHub", repo.githubStatus, repo.githubDetail],
                ["Devin", repo.devinStatus, repo.devinDetail],
              ] as const
            ).map(([label, status, detail]) => (
              <div key={label} className="rounded-md bg-surface-container px-4 py-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <ToneChip tone={STATUS[status].tone} label={STATUS[status].label} className="h-6 text-xs" />
                </div>
                <p className="text-sm break-words text-on-surface-variant">{detail ?? "No details recorded."}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant">
            Checked {formatRelative(repo.checkedAt)}. Verification runs <code className="font-mono">node {repo.recipe.entry}</code>
            {repo.appDir ? ` in ${repo.appDir}` : ""} with {[repo.recipe.portEnv, ...repo.recipe.extraPortEnvs].join(", ")} set.
          </p>
          <RecheckRepositoryButton repositoryId={repo.id} projectId={projectId} />
          <details>
            <summary className="cursor-pointer text-sm text-primary">Change repository settings</summary>
            <div className="mt-4">
              <RepositoryForm projectId={projectId} defaults={defaults} authorized={authorized} />
            </div>
          </details>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-4">
          <p className="text-sm text-on-surface-variant">Link the GitHub repository that serves this site so findings can be sent to Devin for repair and the resulting pull requests verified.</p>
          <RepositoryForm projectId={projectId} defaults={defaults} authorized={authorized} />
        </div>
      )}
    </section>
  );
}
