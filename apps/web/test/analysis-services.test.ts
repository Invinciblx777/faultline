import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, journeys, operators, projects, scans, type DatabaseHandle } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";
import { parseAllowlist } from "@faultline/shared";
import { analysisInputFromForm, createAnalysis, type AnalysisServiceDeps } from "../src/lib/services/analyses";
import { createJourney, reviseJourney } from "../src/lib/services/journeys";
import { createScan } from "../src/lib/services/scans";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const url = process.env.DATABASE_URL_TEST;
let handle: DatabaseHandle;
let operatorId: string;
let projectId: string;
const allowlist = parseAllowlist("https://app.example.test");

const definition = {
  name: "Checkout",
  steps: [
    { type: "navigate", path: "/shop" },
    { type: "assertVisible", target: { by: "text", text: "Cart" } },
  ],
};

beforeAll(async () => {
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a *_test database");
  await runMigrations(url);
  handle = createDatabase(url, { max: 5 });
});

afterAll(async () => handle?.close());

beforeEach(async () => {
  await handle.db.execute(sql`truncate table execution_events, artifacts, scan_executions, scans, journeys, projects, operator_sessions, operators restart identity cascade`);
  const [op] = await handle.db.insert(operators).values({ username: "tester", passwordHash: "scrypt$unused" }).returning();
  operatorId = op!.id;
  const [p] = await handle.db.insert(projects).values({ name: "App", origin: "https://app.example.test" }).returning();
  projectId = p!.id;
});

const deps = (over: Partial<AnalysisServiceDeps> = {}): AnalysisServiceDeps & { jobs: Array<{ id: string; expireInSeconds: number }> } => {
  const jobs: Array<{ id: string; expireInSeconds: number }> = [];
  return { db: handle.db, allowlist, maxActive: 2, enqueue: async (id, o) => (jobs.push({ id, ...o }), `job-${jobs.length}`), jobs, ...over };
};

describe("journeys", () => {
  it("requires an operator and validates the definition", async () => {
    expect((await createJourney({ db: handle.db }, null, { projectId, definition })).ok).toBe(false);
    const bad = await createJourney({ db: handle.db }, { id: operatorId }, { projectId, definition: { name: "x", steps: [{ type: "click", target: { by: "text", text: "a" } }] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/first step must navigate/);
  });

  it("refuses absolute and protocol-relative navigation and engine-prefixed selectors", async () => {
    for (const step of [
      { type: "navigate", path: "https://evil.test/" },
      { type: "navigate", path: "//evil.test/" },
    ]) {
      const r = await createJourney({ db: handle.db }, { id: operatorId }, { projectId, definition: { name: "x", steps: [step] } });
      expect(r.ok, JSON.stringify(step)).toBe(false);
    }
    const css = await createJourney({ db: handle.db }, { id: operatorId }, {
      projectId,
      definition: { name: "x", steps: [{ type: "navigate", path: "/" }, { type: "click", target: { by: "css", selector: "xpath=//a" } }] },
    });
    expect(css.ok).toBe(false);
  });

  it("saves edits as new immutable versions in the same lineage", async () => {
    const v1 = await createJourney({ db: handle.db }, { id: operatorId }, { projectId, definition });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const v2 = await reviseJourney({ db: handle.db }, { id: operatorId }, { journeyId: v1.journeyId, definition: { ...definition, name: "Checkout v2" } });
    expect(v2).toMatchObject({ ok: true, version: 2 });
    const rows = await handle.db.select().from(journeys);
    expect(rows.map((r) => [r.version, r.name]).sort()).toEqual([
      [1, "Checkout"],
      [2, "Checkout v2"],
    ]);
    expect(new Set(rows.map((r) => r.lineageId)).size).toBe(1);
  });
});

describe("createAnalysis", () => {
  async function journey() {
    const r = await createJourney({ db: handle.db }, { id: operatorId }, { projectId, definition });
    if (!r.ok) throw new Error(r.error);
    return r.journeyId;
  }

  it("snapshots the journey version, enqueues with a long expiry, and records the job", async () => {
    const journeyId = await journey();
    const d = deps();
    const result = await createAnalysis(d, { id: operatorId }, { projectId, config: { kind: "blast-radius", journeyId } });
    expect(result.ok).toBe(true);
    const [row] = await handle.db.select().from(scans);
    expect(row).toMatchObject({ status: "queued", scenarioKind: "blast-radius", journeyId, targetUrl: "https://app.example.test/shop", jobId: "job-1" });
    expect(row!.journeySnapshot).toMatchObject({ id: journeyId, version: 1, definition: { name: "Checkout" } });
    expect(d.jobs[0]!.expireInSeconds).toBe(3600);
  });

  it("refuses unauthenticated callers, foreign journeys, and unlisted origins", async () => {
    const journeyId = await journey();
    expect((await createAnalysis(deps(), null, { projectId, config: { kind: "blast-radius", journeyId } })).ok).toBe(false);
    const [other] = await handle.db.insert(projects).values({ name: "Other", origin: "https://other.example.test" }).returning();
    expect((await createAnalysis(deps(), { id: operatorId }, { projectId: other!.id, config: { kind: "blast-radius", journeyId } })).ok).toBe(false);
    const removed = await createAnalysis(deps({ allowlist: [] }), { id: operatorId }, { projectId, config: { kind: "blast-radius", journeyId } });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error).toMatch(/allowlist/);
    expect(await handle.db.select().from(scans)).toHaveLength(0);
  });

  it("allows one active analysis per project and caps the total, even under concurrent launches", async () => {
    const journeyId = await journey();
    const results = await Promise.all([1, 2, 3].map(() => createAnalysis(deps(), { id: operatorId }, { projectId, config: { kind: "blast-radius", journeyId } })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: expect.stringMatching(/already has an analysis/) });

    const [p2] = await handle.db.insert(projects).values({ name: "B", origin: "https://app.example.test" }).returning();
    const j2 = await createJourney({ db: handle.db }, { id: operatorId }, { projectId: p2!.id, definition });
    if (!j2.ok) throw new Error(j2.error);
    const capped = await createAnalysis(deps({ maxActive: 1 }), { id: operatorId }, { projectId: p2!.id, config: { kind: "blast-radius", journeyId: j2.journeyId } });
    expect(capped).toMatchObject({ ok: false, error: expect.stringMatching(/limit 1/) });
  });

  it("refuses an empty fault selection", async () => {
    const journeyId = await journey();
    const r = await createAnalysis(deps(), { id: operatorId }, { projectId, config: { kind: "blast-radius", journeyId, faults: [] } });
    expect(r.ok).toBe(false);
  });

  it("marks the analysis failed when the queue rejects it", async () => {
    const journeyId = await journey();
    const r = await createAnalysis(deps({ enqueue: async () => Promise.reject(new Error("queue down")) }), { id: operatorId }, { projectId, config: { kind: "blast-radius", journeyId } });
    expect(r.ok).toBe(false);
    const [row] = await handle.db.select().from(scans);
    expect(row).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
  });

  it("the page-scan path refuses blast-radius configs", async () => {
    const journeyId = await journey();
    const r = await createScan({ db: handle.db, allowlist, enqueue: async () => "job" }, { id: operatorId }, {
      projectId,
      targetUrl: "https://app.example.test/",
      scenario: { kind: "blast-radius", journeyId },
    });
    expect(r.ok).toBe(false);
    expect(await handle.db.select().from(scans).where(eq(scans.projectId, projectId))).toHaveLength(0);
  });

  it("parses the launch form, including explicit targets", () => {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("journeyId", "j");
    form.append("faults", "unavailable");
    form.set("errorStatus", "500");
    form.set("latencyMs", "2000");
    form.set("includeOffline", "on");
    form.set("confirmFindings", "on");
    form.append("target", "http-error|endpoint GET https://app.example.test/api/a|b");
    const parsed = analysisInputFromForm(form);
    expect(parsed.config).toMatchObject({
      faults: ["unavailable"],
      errorStatus: 500,
      latencyMs: 2000,
      includeOffline: true,
      includeNarrowViewport: false,
      confirmFindings: true,
      targets: [{ fault: "http-error", dependencyKey: "endpoint GET https://app.example.test/api/a|b" }],
    });
  });
});
