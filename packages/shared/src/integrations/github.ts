import { z } from "zod";
import type { GitHubPullFacts } from "../repair";

/**
 * Minimal server-side GitHub REST client for the repair loop: repository
 * and branch checks, pull request facts, commit existence, and source
 * archives for exact commits. Reads only; FAULTLINE never pushes or merges.
 *
 * The token (GITHUB_TOKEN) is only placed in the Authorization header.
 */

export const GITHUB_API = "https://api.github.com";

const repoSchema = z.object({
  full_name: z.string(),
  html_url: z.string().url(),
  private: z.boolean(),
  archived: z.boolean(),
  default_branch: z.string(),
  permissions: z.object({ pull: z.boolean().optional(), push: z.boolean().optional(), admin: z.boolean().optional() }).optional(),
});
export type GitHubRepository = z.infer<typeof repoSchema>;

const branchSchema = z.object({ name: z.string(), commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }), protected: z.boolean().optional() });
export type GitHubBranch = z.infer<typeof branchSchema>;

const pullSchema = z.object({
  number: z.number().int(),
  html_url: z.string().url(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean().nullable().optional(),
  draft: z.boolean().optional(),
  title: z.string(),
  body: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  base: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string() }) }),
  head: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
});

const commitSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), html_url: z.string().url() });

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GitHubClientOptions {
  token: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA = /^[0-9a-f]{40}$/;

function repoPath(owner: string, name: string): string {
  if (!NAME.test(owner) || !NAME.test(name)) throw new GitHubApiError("Invalid repository owner or name.", null);
  return `/repos/${owner}/${name}`;
}

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.baseUrl = (options.baseUrl ?? GITHUB_API).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  get hasToken(): boolean {
    return Boolean(this.options.token);
  }

  private async raw(path: string, accept = "application/vnd.github+json", timeoutMs = this.timeoutMs): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          accept,
          "x-github-api-version": "2022-11-28",
          "user-agent": "faultline-repair",
          ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GitHubApiError(`Could not reach GitHub (${path}): ${error instanceof Error ? error.message : String(error)}`, null);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const hint =
        response.status === 404
          ? " Not found, or GITHUB_TOKEN cannot read it (private repositories need a token with read access)."
          : response.status === 401
            ? " GITHUB_TOKEN was rejected."
            : response.status === 403
              ? " Forbidden or rate-limited."
              : "";
      throw new GitHubApiError(`GitHub ${path} returned HTTP ${response.status}.${hint}`, response.status);
    }
    return response;
  }

  private async json<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    const response = await this.raw(path);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new GitHubApiError(`GitHub ${path} returned an unexpected response.`, response.status);
    return parsed.data;
  }

  async getRepository(owner: string, name: string): Promise<GitHubRepository> {
    return this.json(repoPath(owner, name), repoSchema);
  }

  async getBranch(owner: string, name: string, branch: string): Promise<GitHubBranch> {
    return this.json(`${repoPath(owner, name)}/branches/${encodeURIComponent(branch)}`, branchSchema);
  }

  /** Confirms a commit exists in the repository (or its network) and returns its canonical SHA. */
  async getCommit(owner: string, name: string, sha: string): Promise<{ sha: string; html_url: string }> {
    if (!SHA.test(sha)) throw new GitHubApiError("A full 40-character commit SHA is required.", null);
    return this.json(`${repoPath(owner, name)}/commits/${sha}`, commitSchema);
  }

  async getPullRequest(owner: string, name: string, number: number): Promise<GitHubPullFacts> {
    const pr = await this.json(`${repoPath(owner, name)}/pulls/${number}`, pullSchema);
    return {
      number: pr.number,
      htmlUrl: pr.html_url,
      state: pr.state,
      merged: Boolean(pr.merged) || Boolean(pr.merged_at),
      draft: Boolean(pr.draft),
      title: pr.title,
      body: pr.body,
      baseRef: pr.base.ref,
      baseRepoFullName: pr.base.repo.full_name,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      headRepoFullName: pr.head.repo?.full_name ?? null,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      closedAt: pr.closed_at,
    };
  }

  /** gzip tarball of the repository at an exact commit, size-limited. */
  async downloadTarball(owner: string, name: string, sha: string, maxBytes: number): Promise<Buffer> {
    if (!SHA.test(sha)) throw new GitHubApiError("A full 40-character commit SHA is required.", null);
    const response = await this.raw(`${repoPath(owner, name)}/tarball/${sha}`, "application/vnd.github+json", 120_000);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new GitHubApiError(`The source archive is ${declared} bytes; the limit is ${maxBytes}.`, response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new GitHubApiError("GitHub returned an empty source archive.", response.status);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GitHubApiError(`The source archive exceeds the ${maxBytes}-byte limit.`, response.status);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
}
