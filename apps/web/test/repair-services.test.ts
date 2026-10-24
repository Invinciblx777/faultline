import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, experiments, operators, projects, regressionTests, repairEvents, repairRequests, scans, sourceRepositories, type DatabaseHandle } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";
import { DevinClient, type GitHubClient } from "@faultline/shared/integrations";
import {
  approveRepairRequest,
  checkRepairAccess,
  createRepairRequest,
  DEVIN_ACCESS_MAX_AGE_MS,
  linkRepository,
  repositoryAccessBlock,
  repositoryInputFromForm,
  type RepairServiceDeps,
} from "../src/lib/services/repairs";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_URL_TEST;
let handle: DatabaseHandle;
let operator: { id: string; username: string };
let projectId: string;
const SHA = "c".repeat(40);

beforeAll(async () => {
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a *_test database");
  await runMigrations(url);
  handle = createDatabase(url, { max: 5 });
});

afterAll(async () => handle?.close());

beforeEach(async () => {
  await handle.db.execute(sql`truncate table execution_events, artifacts, scan_executions, scans, journeys, projects, operator_sessions, operators restart identity cascade`);
  const [op] = await handle.db.insert(operators).values({ username: "Alice", passwordHash: "scrypt$unused" }).returning();
  operator = { id: op!.id, username: op!.username };
  const [p] = await handle.db.insert(projects).values({ name: "Shop", origin: "https://shop.example.test" }).returning();
  projectId = p!.id;
});

const github = {
  getRepository: async (owner: string, name: string) => ({ full_name: `${owner}/${name}`, html_url: `https://github.com/${owner}/${name}`, private: true, archived: false, default_branch: "main" }),
  getBranch: async (_o: string, _n: string, branch: string) => ({ name: branch, protected: false, commit: { sha: SHA } }),
} as unknown as GitHubClient;

function deps(over: Partial<RepairServiceDeps> = {}): RepairServiceDeps {
  return { db: handle.db, repositoryAllowlist: ["acme/shop"], approvers: ["alice"], devin: null, devinUnavailable: "DEVIN_API_KEY and DEVIN_ORG_ID are not set.", github, ...over };
}

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ projectId, owner: "acme", name: "shop", baseBranch: "main", entry: "server.mjs", portEnv: "PORT", ...values })) f.set(k, v);
  return f;
}

describe("repository linking", () => {
  it("requires an operator and an authorized repository", async () => {
    expect((await linkRepository(deps(), null, repositoryInputFromForm(form({})))).ok).toBe(false);
    const refused = await linkRepository(deps(), operator, repositoryInputFromForm(form({ name: "other" })));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/FAULTLINE_REPAIR_REPOSITORIES/);
  });

  it("refuses shell-like or path-escaping recipes", async () => {
    for (const entry of ["../x.js", "server.mjs && curl evil", "/abs.js"]) {
      expect((await linkRepository(deps(), operator, repositoryInputFromForm(form({ entry })))).ok).toBe(false);
    }
  });

  it("records what GitHub and Devin report, including when Devin is not configured", async () => {
    const result = await linkRepository(deps(), operator, repositoryInputFromForm(form({ extraPortEnvs: "PARTNER_PORT" })));
    expect(result.ok).toBe(true);
    const [row] = await handle.db.select().from(sourceRepositories).where(eq(sourceRepositories.projectId, projectId));
    expect(row).toMatchObject({ owner: "acme", name: "shop", githubStatus: "ok", baseSha: SHA, devinStatus: "not_configured" });
    expect(row!.recipe.extraPortEnvs).toEqual(["PARTNER_PORT"]);

    const devin = fakeDevin({ repos: [] });
    await linkRepository(deps({ devin: devin.client, devinUnavailable: null }), operator, repositoryInputFromForm(form({})));
    const [again] = await handle.db.select().from(sourceRepositories).where(eq(sourceRepositories.projectId, projectId));
    expect(again!.devinStatus).toBe("error");
    expect(again!.devinDetail).toMatch(/Connections/);
    expect(again!.devinCheckedAt).not.toBeNull();
  });
});

describe("repair requests", () => {
  it("cannot be created without a linked repository or for an unknown finding", async () => {
    expect((await createRepairRequest(deps(), operator, "not-a-uuid")).ok).toBe(false);
    const missing = await createRepairRequest(deps(), operator, "00000000-0000-4000-8000-000000000000");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/does not exist/);
  });

  it("approval requires an approver, a configured Devin, and an explicit confirmation", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const sha = "d".repeat(64);
    const notApprover = await approveRepairRequest(deps({ approvers: ["bob"] }), operator, { repairId: id, evidenceSha256: sha, confirmed: true });
    expect(!notApprover.ok && notApprover.error).toMatch(/FAULTLINE_REPAIR_APPROVERS/);
    const noDevin = await approveRepairRequest(deps(), operator, { repairId: id, evidenceSha256: sha, confirmed: true });
    expect(!noDevin.ok && noDevin.error).toMatch(/not configured/);
    const devin = {} as DevinClient;
    const unconfirmed = await approveRepairRequest(deps({ devin, devinUnavailable: null }), operator, { repairId: id, evidenceSha256: sha, confirmed: false });
    expect(!unconfirmed.ok && unconfirmed.error).toMatch(/Confirm/);
    const unknown = await approveRepairRequest(deps({ devin, devinUnavailable: null }), operator, { repairId: id, evidenceSha256: sha, confirmed: true });
    expect(!unknown.ok && unknown.error).toMatch(/already approved, cancelled, or its evidence changed/);
  });
});

/** Devin API v3 at the HTTP layer. Records every call; any POST would mean a session or upload was attempted. */
function fakeDevin(behaviour: { orgId?: string | null; repos?: Array<{ full: string; host?: string }>; selfStatus?: number; reposStatus?: number }) {
  const calls: Array<{ method: string; path: string }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname });
    if (method === "GET" && url.pathname === "/v3/self") {
      if (behaviour.selfStatus) return json({ title: "Problem", status: behaviour.selfStatus }, behaviour.selfStatus);
      return json({ principal_type: "service_user", service_user_name: "faultline", org_id: behaviour.orgId === undefined ? "org-test" : behaviour.orgId });
    }
    if (method === "GET" && url.pathname === "/v3/organizations/org-test/repositories") {
      if (behaviour.reposStatus) return json({ title: "Problem", status: behaviour.reposStatus }, behaviour.reposStatus);
      const items = (behaviour.repos ?? []).map((r) => ({ repo_full_name: r.full, repo_name: r.full.split("/")[1], repo_path: r.full, git_connection_host: r.host ?? "github.com" }));
      return json({ items, has_next_page: false, end_cursor: null });
    }
    return json({ title: "unexpected", status: 500 }, 500);
  }) as typeof fetch;
  const client = new DevinClient({ apiKey: "cog_test_key_0123456789", orgId: "org-test", baseUrl: "https://api.devin.test", fetch: impl, maxAttempts: 1, sleep: async () => undefined });
  return { client, calls };
}

/** A repair awaiting approval, with the minimal rows its foreign keys need. */
async function pendingRepair(repoValues: Partial<typeof sourceRepositories.$inferInsert> = {}) {
  const [repo] = await handle.db
    .insert(sourceRepositories)
    .values({ projectId, provider: "github", owner: "acme", name: "shop", url: "https://github.com/acme/shop", baseBranch: "main", recipe: { kind: "node-server", entry: "server.mjs", portEnv: "PORT", extraPortEnvs: [], hostEnv: null }, ...repoValues })
    .returning();
  const [scan] = await handle.db.insert(scans).values({ projectId, targetUrl: "https://shop.example.test/", scenarioKind: "blast_radius" as never, scenarioConfig: {} as never }).returning();
  const [experiment] = await handle.db.insert(experiments).values({ scanId: scan!.id, ordinal: 1, kind: "dependency" as never, fault: {} as never }).returning();
  const [test] = await handle.db.insert(regressionTests).values({ experimentId: experiment!.id, scanId: scan!.id, filename: "t.spec.ts", content: "test", sha256: "e".repeat(64), command: "npx playwright test" }).returning();
  const id = randomUUID();
  const [repair] = await handle.db
    .insert(repairRequests)
    .values({
      id,
      projectId,
      scanId: scan!.id,
      experimentId: experiment!.id,
      repositoryId: repo!.id,
      repoOwner: "acme",
      repoName: "shop",
      baseBranch: "main",
      evidence: {} as never,
      evidenceSha256: "d".repeat(64),
      prompt: "prompt",
      promptSha256: "f".repeat(64),
      regressionTestId: test!.id,
      regressionTestSha256: "e".repeat(64),
      devinTag: `faultline-repair-${id}`,
    })
    .returning();
  return { repair: repair!, repo: repo! };
}

const approval = (repairId: string) => ({ repairId, evidenceSha256: "d".repeat(64), confirmed: true });
const reloadRepair = async (id: string) => (await handle.db.select().from(repairRequests).where(eq(repairRequests.id, id)))[0]!;
const reloadRepo = async (id: string) => (await handle.db.select().from(sourceRepositories).where(eq(sourceRepositories.id, id)))[0]!;

describe("repository access preflight on approval", () => {
  it("approves only after a live check confirms the exact repository, using read-only Devin calls", async () => {
    const { repair, repo } = await pendingRepair();
    const devin = fakeDevin({ repos: [{ full: "acme/shop" }] });
    const result = await approveRepairRequest(deps({ devin: devin.client, devinUnavailable: null }), operator, approval(repair.id));
    expect(result).toEqual({ ok: true });
    expect(devin.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v3/self", "GET /v3/organizations/org-test/repositories"]);
    const row = await reloadRepair(repair.id);
    expect(row.status).toBe("queued");
    expect(row.approvedByUsername).toBe("Alice");
    const stored = await reloadRepo(repo.id);
    expect(stored).toMatchObject({ devinStatus: "ok", devinRepoName: "acme/shop" });
    expect(repositoryAccessBlock(stored, row)).toBeNull();
    const [approved] = await handle.db.select().from(repairEvents).where(eq(repairEvents.repairId, repair.id));
    expect(approved!.detail).toMatchObject({ evidenceSha256: "d".repeat(64), repositoryAccess: { repoName: "acme/shop", host: "github.com" } });
  });

  it("refuses when Devin does not list the repository, even if an earlier check succeeded", async () => {
    const { repair, repo } = await pendingRepair({ devinStatus: "ok", devinRepoName: "acme/shop", devinCheckedAt: new Date() });
    const devin = fakeDevin({ repos: [{ full: "acme/shop-old" }] });
    const result = await approveRepairRequest(deps({ devin: devin.client, devinUnavailable: null }), operator, approval(repair.id));
    expect(!result.ok && result.error).toMatch(/do not list acme\/shop/);
    expect((await reloadRepair(repair.id)).status).toBe("awaiting_approval");
    const stored = await reloadRepo(repo.id);
    expect(stored).toMatchObject({ devinStatus: "error", devinRepoName: null });
    expect(stored.devinCheckedAt).not.toBeNull();
    expect(repositoryAccessBlock(stored, repair)).toMatch(/Devin cannot use acme\/shop/);
    expect(devin.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("refuses when the key belongs to another organization or Devin refuses the organization", async () => {
    const { repair } = await pendingRepair();
    const other = fakeDevin({ orgId: "org-other", repos: [{ full: "acme/shop" }] });
    const wrongKey = await approveRepairRequest(deps({ devin: other.client, devinUnavailable: null }), operator, approval(repair.id));
    expect(!wrongKey.ok && wrongKey.error).toMatch(/belongs to org-other/);
    const refused = fakeDevin({ orgId: null, reposStatus: 404 });
    const wrongOrg = await approveRepairRequest(deps({ devin: refused.client, devinUnavailable: null }), operator, approval(repair.id));
    expect(!wrongOrg.ok && wrongOrg.error).toMatch(/refused to list repositories for org-test/);
    expect((await reloadRepair(repair.id)).status).toBe("awaiting_approval");
  });

  it("refuses when the Devin API request fails", async () => {
    const { repair } = await pendingRepair();
    for (const devin of [fakeDevin({ selfStatus: 401 }), fakeDevin({ selfStatus: 500 }), fakeDevin({ reposStatus: 503 })]) {
      const result = await approveRepairRequest(deps({ devin: devin.client, devinUnavailable: null }), operator, approval(repair.id));
      expect(result.ok).toBe(false);
    }
    expect((await reloadRepair(repair.id)).status).toBe("awaiting_approval");
  });

  it("refuses when the project was relinked to another repository, without calling Devin", async () => {
    const { repair, repo } = await pendingRepair();
    await handle.db.update(sourceRepositories).set({ name: "shop-v2" }).where(eq(sourceRepositories.id, repo.id));
    const devin = fakeDevin({ repos: [{ full: "acme/shop" }, { full: "acme/shop-v2" }] });
    const result = await approveRepairRequest(deps({ devin: devin.client, devinUnavailable: null }), operator, approval(repair.id));
    expect(!result.ok && result.error).toMatch(/now linked to acme\/shop-v2/);
    expect(devin.calls).toHaveLength(0);
    expect(repositoryAccessBlock(await reloadRepo(repo.id), repair)).toMatch(/Create a new repair request/);
  });

  it("keeps the approval button disabled for missing, unchecked, failed, or stale access state", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const repair = { repoOwner: "acme", repoName: "shop" };
    const fresh = { owner: "acme", name: "shop", devinStatus: "ok" as const, devinDetail: "ok", devinCheckedAt: new Date(now.getTime() - 60_000) };
    expect(repositoryAccessBlock(fresh, repair, now)).toBeNull();
    expect(repositoryAccessBlock({ ...fresh, owner: "ACME" }, repair, now)).toBeNull();
    expect(repositoryAccessBlock(null, repair, now)).toMatch(/no longer exists/);
    expect(repositoryAccessBlock({ ...fresh, devinStatus: "not_checked", devinCheckedAt: null }, repair, now)).toMatch(/Devin cannot use/);
    expect(repositoryAccessBlock({ ...fresh, devinCheckedAt: null }, repair, now)).toMatch(/has not been checked live/);
    expect(repositoryAccessBlock({ ...fresh, devinCheckedAt: new Date(now.getTime() - DEVIN_ACCESS_MAX_AGE_MS - 1000) }, repair, now)).toMatch(/last confirmed 10 minutes ago/);
  });

  it("an explicit access check stores a fresh result that enables approval", async () => {
    const { repair, repo } = await pendingRepair();
    expect(repositoryAccessBlock(await reloadRepo(repo.id), repair)).not.toBeNull();
    const devin = fakeDevin({ repos: [{ full: "acme/shop" }] });
    expect(await checkRepairAccess(deps({ devin: devin.client, devinUnavailable: null }), operator, repair.id)).toEqual({ ok: true });
    expect(repositoryAccessBlock(await reloadRepo(repo.id), repair)).toBeNull();
    expect((await reloadRepair(repair.id)).status).toBe("awaiting_approval");
    expect((await checkRepairAccess(deps(), operator, repair.id)).ok).toBe(false);
  });
});
