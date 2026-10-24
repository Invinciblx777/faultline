import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArtifactStorage,
  artifacts,
  dependencies,
  experiments,
  journeys,
  networkRequests,
  projects,
  regressionTests,
  scanExecutions,
  scans,
  stepResults,
  storageConfigFromEnv,
  type DatabaseHandle,
} from "@faultline/db";
import { journeyDefinitionSchema, parseAllowlist, scenarioConfigSchema } from "@faultline/shared";
import type { WorkerEnv } from "@faultline/shared/env";
import { createRuntimeInfo } from "../src/runtime";
import { validateRegressionTest } from "../src/regression-validator";
import { runScan, type RunnerDeps } from "../src/scan-runner";
import { startFixedStorefront, startStorefront, type RunningServer } from "./fixtures";
import { openTestDatabase, resetTestDatabase, testEnv } from "./integration-env";

let shop: RunningServer;
let partner: RunningServer;
let env: WorkerEnv;
let handle: DatabaseHandle;
let storage: ArtifactStorage;
let deps: RunnerDeps;

beforeAll(async () => {
  ({ shop, partner } = await startStorefront());
  env = testEnv({ FAULTLINE_SCAN_ALLOWLIST: `${shop.origin},${partner.origin}` });
  handle = await openTestDatabase(env);
  storage = new ArtifactStorage(storageConfigFromEnv(env));
  await storage.ensureBucket();
  deps = { db: handle.db, storage, env, runtime: { ...createRuntimeInfo(), browserVersion: null }, heartbeatIntervalMs: 500 };
  await resetTestDatabase(handle);
});

afterAll(async () => {
  await handle?.close();
  await Promise.all([shop?.close(), partner?.close()]);
});

async function createAnalysis(config: Record<string, unknown>) {
  const [project] = await handle.db.insert(projects).values({ name: "Storefront", origin: shop.origin }).returning();
  const definition = journeyDefinitionSchema.parse({
    name: "Buy a backpack",
    steps: [
      { type: "navigate", path: "/shop/" },
      { type: "assertVisible", target: { by: "text", text: "Trail Backpack" } },
      { type: "click", target: { by: "role", role: "button", name: "Add Trail Backpack to cart" } },
      { type: "assertText", target: { by: "testId", testId: "cart-count" }, text: "1 item" },
      { type: "fill", target: { by: "label", label: "ZIP code" }, value: "94107" },
      { type: "click", target: { by: "role", role: "button", name: "Get shipping quote" } },
      { type: "assertText", target: { by: "testId", testId: "order-total" }, text: "Total", maxDurationMs: 2000 },
      { type: "assertEnabled", target: { by: "role", role: "button", name: "Place order" } },
    ],
  });
  const lineageId = randomUUID();
  const [journey] = await handle.db
    .insert(journeys)
    .values({ projectId: project!.id, lineageId, version: 1, name: definition.name, definition })
    .returning();
  const scenario = scenarioConfigSchema.parse({ kind: "blast-radius", journeyId: journey!.id, ...config });
  const [scan] = await handle.db
    .insert(scans)
    .values({
      projectId: project!.id,
      targetUrl: `${shop.origin}/shop/`,
      scenarioKind: scenario.kind,
      scenarioConfig: scenario,
      journeyId: journey!.id,
      journeySnapshot: { id: journey!.id, lineageId, version: 1, definition },
    })
    .returning();
  return scan!;
}

describe("Blast Radius analysis lifecycle", () => {
  it("runs baseline, calibration, isolated experiments, persists evidence, and validates a regression test", async () => {
    const scan = await createAnalysis({
      targets: [
        { dependencyKey: `endpoint GET ${shop.origin}/api/inventory`, fault: "http-error" },
        { dependencyKey: `origin ${partner.origin}`, fault: "unavailable" },
        { dependencyKey: `endpoint GET ${shop.origin}/api/gone`, fault: "unavailable" },
      ],
      confirmFindings: true,
    });
    await runScan(deps, scan.id);

    const [row] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(row!.status).toBe("completed");
    expect(row!.analysis?.stableSteps).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(row!.analysis?.calibration?.screenshotDiffRatio).not.toBeNull();
    expect(row!.analysis?.skippedCandidates.map((s) => s.dependencyKey)).toEqual([`endpoint GET ${shop.origin}/api/gone`]);

    const executions = await handle.db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id)).orderBy(asc(scanExecutions.createdAt));
    expect(executions.map((e) => `${e.role}:${e.attempt}`)).toEqual(["baseline:1", "calibration:1", "experiment:1", "experiment:2", "experiment:1"]);
    expect(executions.every((e) => e.status === "completed")).toBe(true);

    const found = await handle.db.select().from(dependencies).where(eq(dependencies.scanId, scan.id));
    expect(found.map((d) => d.key)).toContain(`endpoint GET ${shop.origin}/api/inventory`);
    const quote = found.find((d) => d.key.endsWith("/api/shipping-quote"))!;
    expect(quote.requestedDuringSteps).toEqual([5]);

    const exps = await handle.db.select().from(experiments).where(eq(experiments.scanId, scan.id)).orderBy(asc(experiments.ordinal));
    expect(exps.map((e) => [e.kind, e.verdict, e.reproducibility])).toEqual([
      ["http-error", "broken", "reproduced"],
      ["unavailable", "resilient", "single-run"],
    ]);
    const inventory = exps[0]!;
    expect(inventory.affectedRequestCount).toBe(1);
    expect(inventory.affectedSteps).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(inventory.newErrors.some((e) => e.message.includes("Storefront failed to load"))).toBe(true);
    expect(inventory.visual?.significant).toBe(true);
    expect(inventory.dependencyId).toBe(found.find((d) => d.key === inventory.dependencyKey)!.id);

    const firstAttempt = executions[2]!;
    const steps = await handle.db.select().from(stepResults).where(eq(stepResults.executionId, firstAttempt.id)).orderBy(asc(stepResults.stepIndex));
    expect(steps.map((s) => s.status)).toEqual(["passed", "failed", ...Array(6).fill("not_reached")]);
    expect(steps[1]!.detail).toHaveProperty("screenshotArtifactId");
    const injected = await handle.db.select().from(networkRequests).where(eq(networkRequests.executionId, firstAttempt.id));
    expect(injected.filter((r) => r.injected === "error-response").map((r) => r.status)).toEqual([503]);

    // Every artifact in MinIO matches its recorded hash.
    const files = await handle.db.select().from(artifacts).where(eq(artifacts.scanId, scan.id));
    expect(new Set(files.map((f) => f.kind))).toEqual(new Set(["screenshot", "step-screenshot", "diff"]));
    for (const file of files) {
      const bytes = await storage.getBuffer(file.storageKey);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }

    // The finding has an executable regression test that fails against the unfixed target.
    const tests = await handle.db.select().from(regressionTests).where(eq(regressionTests.scanId, scan.id));
    expect(tests).toHaveLength(1);
    expect(tests[0]!.experimentId).toBe(inventory.id);
    expect(tests[0]!.content).toContain("status: 503,");
    expect(tests[0]!.validationStatus).toBe("fails_as_expected");
    expect(tests[0]!.validationSummary).toMatch(/Trail Backpack/);

    // The same exported test passes against a storefront that tolerates the inventory failure.
    const fixed = await startFixedStorefront(partner.origin);
    try {
      const result = await validateRegressionTest({
        filename: tests[0]!.filename,
        content: tests[0]!.content,
        targetOrigin: fixed.origin,
        policy: { mode: "local", allowlist: parseAllowlist(`${fixed.origin},${partner.origin}`), subresourcePolicy: "public" },
        maxTransferBytes: 50 * 1024 * 1024,
        chromiumSandbox: env.FAULTLINE_CHROMIUM_SANDBOX,
        timeoutMs: 120_000,
      });
      expect(result.status, result.output).toBe("passes");
    } finally {
      await fixed.close();
    }
  }, 300_000);

  it("refuses to run a journey snapshot that is missing", async () => {
    const scan = await createAnalysis({ maxExperiments: 1 });
    await handle.db.update(scans).set({ journeySnapshot: null }).where(eq(scans.id, scan.id));
    await runScan(deps, scan.id);
    const [row] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(row!.status).toBe("failed");
    expect(row!.errorMessage).toMatch(/journey snapshot/);
  });
});
