import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, operators, projects, sourceRepositories, type DatabaseHandle } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";
import type { DevinClient, GitHubClient } from "@faultline/shared/integrations";
import { approveRepairRequest, createRepairRequest, linkRepository, repositoryInputFromForm, type RepairServiceDeps } from "../src/lib/services/repairs";

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

    const devin = { findRepository: async () => null } as unknown as DevinClient;
    await linkRepository(deps({ devin, devinUnavailable: null }), operator, repositoryInputFromForm(form({})));
    const [again] = await handle.db.select().from(sourceRepositories).where(eq(sourceRepositories.projectId, projectId));
    expect(again!.devinStatus).toBe("error");
    expect(again!.devinDetail).toMatch(/Connections/);
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
