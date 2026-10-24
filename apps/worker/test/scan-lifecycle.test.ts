import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  ArtifactStorage,
  artifacts,
  createBoss,
  ensureScanQueue,
  executionEvents,
  failStaleScans,
  projects,
  requestScanCancellation,
  SCAN_QUEUE,
  scanExecutions,
  scans,
  storageConfigFromEnv,
  type DatabaseHandle,
  type ScanJobData,
} from "@faultline/db";
import { scenarioConfigSchema, type ScenarioConfig } from "@faultline/shared";
import type { WorkerEnv } from "@faultline/shared/env";
import { createRuntimeInfo } from "../src/runtime";
import { runScan, type RunnerDeps } from "../src/scan-runner";
import { startReferenceTarget, type RunningServer } from "./fixtures";
import { openTestDatabase, resetTestDatabase, testEnv } from "./integration-env";

let reference: RunningServer;
let env: WorkerEnv;
let handle: DatabaseHandle;
let storage: ArtifactStorage;
let deps: RunnerDeps;

beforeAll(async () => {
  reference = await startReferenceTarget();
  env = testEnv({ FAULTLINE_SCAN_ALLOWLIST: reference.origin });
  handle = await openTestDatabase(env);
  storage = new ArtifactStorage(storageConfigFromEnv(env));
  await storage.ensureBucket();
  deps = { db: handle.db, storage, env, runtime: { ...createRuntimeInfo(), browserVersion: null }, heartbeatIntervalMs: 500 };
});

afterAll(async () => {
  await handle?.close();
  await reference?.close();
});

beforeEach(async () => {
  await resetTestDatabase(handle);
});

async function createScan(config: Partial<ScenarioConfig> & { kind: ScenarioConfig["kind"] }, path = "/") {
  const [project] = await handle.db.insert(projects).values({ name: "Reference target", origin: reference.origin }).returning();
  const scenario = scenarioConfigSchema.parse(config);
  const [scan] = await handle.db
    .insert(scans)
    .values({ projectId: project!.id, targetUrl: `${reference.origin}${path}`, scenarioKind: scenario.kind, scenarioConfig: scenario })
    .returning();
  return scan!;
}

describe("scan job lifecycle", () => {
  it("runs a resource-block scan end to end and persists evidence and artifacts", async () => {
    const scan = await createScan({ kind: "resource-block", resourceTypes: ["stylesheet"] });
    await runScan(deps, scan.id);

    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("completed");
    expect(after?.startedAt).toBeInstanceOf(Date);
    expect(after?.finishedAt).toBeInstanceOf(Date);
    expect(after?.durationMs).toBeGreaterThan(0);
    expect(after?.environment?.browserName).toBe("chromium");
    expect(after?.environment?.egress.guard).toBe("faultline-egress-proxy");

    const executions = await handle.db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id)).orderBy(asc(scanExecutions.role));
    expect(executions.map((e) => [e.role, e.status, e.outcome])).toEqual([
      ["baseline", "completed", "loaded"],
      ["fault", "completed", "loaded"],
    ]);
    const fault = executions.find((e) => e.role === "fault")!;
    expect(fault.summary?.intentionallyBlocked).toBe(1);
    const faultEvents = await handle.db.select().from(executionEvents).where(eq(executionEvents.executionId, fault.id)).orderBy(asc(executionEvents.seq));
    expect(faultEvents.some((e) => e.kind === "fault_injected" && e.url?.endsWith("/styles.css"))).toBe(true);
    expect(faultEvents.some((e) => e.kind === "page_error" && /RangeError/.test(e.message))).toBe(true);

    // Artifacts exist in object storage and their recorded hashes match the stored bytes.
    const stored = await handle.db.select().from(artifacts).where(eq(artifacts.scanId, scan.id));
    expect(stored).toHaveLength(2);
    for (const artifact of stored) {
      const bytes = await storage.getBuffer(artifact.storageKey);
      expect(bytes.length).toBe(artifact.byteSize);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    }
  });

  it("runs an offline-reload scan and records the emulated offline failure", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    await runScan(deps, scan.id);
    const executions = await handle.db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id));
    const byRole = Object.fromEntries(executions.map((e) => [e.role, e]));
    expect(byRole.baseline?.outcome).toBe("loaded");
    expect(byRole.fault?.outcome).toBe("navigation_failed");
    expect(byRole.fault?.navigationError).toMatch(/ERR_INTERNET_DISCONNECTED/);
  });

  it("does not run a scan that was cancelled while queued", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    expect(await requestScanCancellation(handle.db, scan.id)).toBe("cancelled");
    await runScan(deps, scan.id);
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("cancelled");
    expect(await handle.db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id))).toHaveLength(0);
  });

  it("cancels a running scan when the operator requests it", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    const run = runScan(deps, scan.id);
    // Request cancellation as soon as the scan is running.
    for (let i = 0; i < 100; i++) {
      const [row] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
      if (row?.status === "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await requestScanCancellation(handle.db, scan.id)).toBe("cancel_requested");
    await run;
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("cancelled");
  });

  it("refuses at execution time if the origin is no longer allowlisted", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    await runScan({ ...deps, env: { ...env, FAULTLINE_SCAN_ALLOWLIST: [] } }, scan.id);
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("failed");
    expect(after?.errorCode).toBe("target_not_authorized");
  });

  it("reports browser launch failures as failed scans, never as completed", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    await runScan({ ...deps, launchBrowser: () => chromium.launch({ executablePath: "/nonexistent/faultline-chromium", timeout: 5_000 }) }, scan.id);
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("failed");
    expect(after?.errorCode).toBe("browser_launch_failed");
  });

  it("marks scans whose worker stopped reporting as failed", async () => {
    const scan = await createScan({ kind: "offline-reload" });
    await handle.db
      .update(scans)
      .set({ status: "running", startedAt: new Date(Date.now() - 600_000), heartbeatAt: new Date(Date.now() - 600_000) })
      .where(eq(scans.id, scan.id));
    const failed = await failStaleScans(handle.db, 90_000);
    expect(failed.map((f) => f.id)).toEqual([scan.id]);
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("failed");
    expect(after?.errorCode).toBe("worker_interrupted");
  });

  it("processes a job delivered through the pg-boss queue", async () => {
    const scan = await createScan({ kind: "resource-block", resourceTypes: ["image"] });
    const boss = createBoss(env.DATABASE_URL, "faultline-test");
    await boss.start();
    try {
      await ensureScanQueue(boss);
      const done = new Promise<void>((resolve, reject) => {
        void boss.work<ScanJobData>(SCAN_QUEUE, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async ([job]) => {
          try {
            await runScan(deps, job!.data.scanId, job!.signal);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      const jobId = await boss.send(SCAN_QUEUE, { scanId: scan.id } satisfies ScanJobData);
      expect(jobId).toBeTruthy();
      await done;
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 });
    }
    const [after] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(after?.status).toBe("completed");
    const executions = await handle.db.select().from(scanExecutions).where(eq(scanExecutions.scanId, scan.id));
    const fault = executions.find((e) => e.role === "fault");
    // logo.svg plus the missing banner image are both aborted as images.
    expect(fault?.summary?.intentionallyBlocked).toBe(2);
  });
});
