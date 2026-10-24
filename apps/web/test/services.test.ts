import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, operators, projects, scans, type DatabaseHandle } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";
import { parseAllowlist } from "@faultline/shared";
import { createProject } from "../src/lib/services/projects";
import { createScan, scanInputFromForm } from "../src/lib/services/scans";
import { loginBlocked, recordLoginFailure, resetRateLimiter } from "../src/lib/auth/rate-limit";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_URL_TEST;
let handle: DatabaseHandle;
let operatorId: string;
const allowlist = parseAllowlist("https://app.example.test, http://localhost:4600");

beforeAll(async () => {
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a *_test database");
  await runMigrations(url);
  handle = createDatabase(url, { max: 3 });
});

afterAll(async () => handle?.close());

beforeEach(async () => {
  await handle.db.execute(sql`truncate table execution_events, artifacts, scan_executions, scans, projects, operator_sessions, operators restart identity cascade`);
  const [op] = await handle.db.insert(operators).values({ username: "tester", passwordHash: "scrypt$unused" }).returning();
  operatorId = op!.id;
});

describe("createProject", () => {
  it("requires a signed-in operator", async () => {
    const result = await createProject({ db: handle.db, allowlist }, null, { name: "x", origin: "https://app.example.test" });
    expect(result).toMatchObject({ ok: false });
    expect(await handle.db.select().from(projects)).toHaveLength(0);
  });

  it("rejects origins that are not on the allowlist", async () => {
    const result = await createProject({ db: handle.db, allowlist }, { id: operatorId }, { name: "Evil", origin: "http://169.254.169.254" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.fieldErrors?.origin).toMatch(/allowlist/);
  });

  it("rejects paths and invalid schemes", async () => {
    for (const origin of ["https://app.example.test/admin", "file:///etc/passwd", "javascript:alert(1)"]) {
      const result = await createProject({ db: handle.db, allowlist }, { id: operatorId }, { name: "x", origin });
      expect(result.ok, origin).toBe(false);
    }
  });

  it("normalizes and persists an allowlisted origin", async () => {
    const result = await createProject({ db: handle.db, allowlist }, { id: operatorId }, { name: "  App  ", origin: "HTTPS://App.Example.test/" });
    expect(result.ok).toBe(true);
    const [row] = await handle.db.select().from(projects);
    expect(row).toMatchObject({ name: "App", origin: "https://app.example.test", createdBy: operatorId });
  });
});

describe("createScan", () => {
  async function project() {
    const [row] = await handle.db.insert(projects).values({ name: "App", origin: "https://app.example.test" }).returning();
    return row!;
  }
  const scenario = { kind: "resource-block", resourceTypes: ["stylesheet"] };

  it("refuses unauthenticated callers and enqueues nothing", async () => {
    const p = await project();
    const enqueued: string[] = [];
    const result = await createScan({ db: handle.db, allowlist, enqueue: async (id) => (enqueued.push(id), "job") }, null, {
      projectId: p.id,
      targetUrl: "https://app.example.test/",
      scenario,
    });
    expect(result.ok).toBe(false);
    expect(enqueued).toHaveLength(0);
    expect(await handle.db.select().from(scans)).toHaveLength(0);
  });

  it("refuses URLs outside the project origin", async () => {
    const p = await project();
    const result = await createScan({ db: handle.db, allowlist, enqueue: async () => "job" }, { id: operatorId }, {
      projectId: p.id,
      targetUrl: "http://localhost:4600/",
      scenario,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses scans when the origin was removed from the allowlist", async () => {
    const p = await project();
    const result = await createScan({ db: handle.db, allowlist: [], enqueue: async () => "job" }, { id: operatorId }, {
      projectId: p.id,
      targetUrl: "https://app.example.test/",
      scenario,
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/allowlist/);
  });

  it("persists a queued scan and records the job id", async () => {
    const p = await project();
    const result = await createScan({ db: handle.db, allowlist, enqueue: async () => "job-123" }, { id: operatorId }, {
      projectId: p.id,
      targetUrl: "https://app.example.test/pricing#plans",
      scenario,
    });
    expect(result.ok).toBe(true);
    const [row] = await handle.db.select().from(scans);
    expect(row).toMatchObject({ status: "queued", jobId: "job-123", targetUrl: "https://app.example.test/pricing", scenarioKind: "resource-block" });
    expect(row?.scenarioConfig).toEqual({ kind: "resource-block", resourceTypes: ["stylesheet"], scope: "all", abortErrorCode: "failed", viewport: "desktop" });
  });

  it("marks the scan failed, never queued forever, when the queue rejects it", async () => {
    const p = await project();
    const result = await createScan(
      { db: handle.db, allowlist, enqueue: async () => Promise.reject(new Error("queue down")) },
      { id: operatorId },
      { projectId: p.id, targetUrl: "https://app.example.test/", scenario },
    );
    expect(result.ok).toBe(false);
    const [row] = await handle.db.select().from(scans);
    expect(row).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
  });

  it("rejects malformed scenarios and unknown projects", async () => {
    const p = await project();
    const deps = { db: handle.db, allowlist, enqueue: async () => "job" };
    expect((await createScan(deps, { id: operatorId }, { projectId: p.id, targetUrl: "https://app.example.test/", scenario: { kind: "resource-block", resourceTypes: ["document"] } })).ok).toBe(false);
    expect((await createScan(deps, { id: operatorId }, { projectId: "00000000-0000-4000-8000-000000000000", targetUrl: "https://app.example.test/", scenario })).ok).toBe(false);
    expect((await createScan(deps, { id: operatorId }, { projectId: "not-a-uuid", targetUrl: "https://app.example.test/", scenario })).ok).toBe(false);
  });

  it("parses the new-scan form", () => {
    const form = new FormData();
    form.set("projectId", "p");
    form.set("targetUrl", "https://app.example.test/");
    form.set("scenarioKind", "resource-block");
    form.append("resourceTypes", "image");
    form.append("resourceTypes", "font");
    form.set("viewport", "mobile");
    expect(scanInputFromForm(form).scenario).toMatchObject({ kind: "resource-block", resourceTypes: ["image", "font"], viewport: "mobile" });
  });
});

describe("login throttling", () => {
  it("blocks a username after repeated failures", () => {
    resetRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordLoginFailure("Operator", "1.2.3.4", now);
    expect(loginBlocked("operator", "5.6.7.8", now).blocked).toBe(true);
    expect(loginBlocked("other", "5.6.7.8", now).blocked).toBe(false);
    expect(loginBlocked("operator", "5.6.7.8", now + 16 * 60_000).blocked).toBe(false);
  });
});

