import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimScan, createDatabase, failQueuedScan, finishScan, heartbeatScan, projects, requestScanCancellation, scans, screenshotKey, type DatabaseHandle } from "../src";
import { runMigrations } from "../src/migrate";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

let handle: DatabaseHandle;

beforeAll(async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a *_test database");
  await runMigrations(url);
  await runMigrations(url); // idempotent
  handle = createDatabase(url, { max: 4 });
});
afterAll(async () => handle?.close());
beforeEach(async () => {
  await handle.db.execute(sql`truncate table scans, projects restart identity cascade`);
});

async function queuedScan() {
  const [p] = await handle.db.insert(projects).values({ name: "p", origin: "https://example.test" }).returning();
  const [s] = await handle.db
    .insert(scans)
    .values({ projectId: p!.id, targetUrl: "https://example.test/", scenarioKind: "offline-reload", scenarioConfig: { kind: "offline-reload", viewport: "desktop" } })
    .returning();
  return s!;
}

describe("scan lifecycle transitions", () => {
  it("lets exactly one worker claim a queued scan", async () => {
    const scan = await queuedScan();
    const results = await Promise.all([claimScan(handle.db, scan.id, "w1"), claimScan(handle.db, scan.id, "w2"), claimScan(handle.db, scan.id, "w3")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("only finishes running scans and records duration", async () => {
    const scan = await queuedScan();
    expect(await finishScan(handle.db, scan.id, { status: "completed" })).toBeNull();
    await claimScan(handle.db, scan.id, "w1");
    const done = await finishScan(handle.db, scan.id, { status: "completed" });
    expect(done?.status).toBe("completed");
    expect(done?.durationMs).toBeGreaterThanOrEqual(0);
    // A completed scan can never be flipped to failed or cancelled afterwards.
    expect(await finishScan(handle.db, scan.id, { status: "failed" })).toBeNull();
    expect(await requestScanCancellation(handle.db, scan.id)).toBe("not_cancellable");
  });

  it("cancels queued scans immediately and flags running ones", async () => {
    const queued = await queuedScan();
    expect(await requestScanCancellation(handle.db, queued.id)).toBe("cancelled");
    expect(await claimScan(handle.db, queued.id, "w1")).toBeNull();

    const running = await queuedScan();
    await claimScan(handle.db, running.id, "w1");
    expect(await requestScanCancellation(handle.db, running.id)).toBe("cancel_requested");
    expect(await heartbeatScan(handle.db, running.id, "phase")).toEqual({ cancelRequested: true, running: true });
  });

  it("fails a queued scan that could not be enqueued", async () => {
    const scan = await queuedScan();
    await failQueuedScan(handle.db, scan.id, "enqueue_failed", "queue down");
    const [row] = await handle.db.select().from(scans).where(eq(scans.id, scan.id));
    expect(row).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
  });
});

describe("artifact keys", () => {
  it("are built only from UUIDs", () => {
    const id = "6f1c1b7e-1f5e-4c55-9d7c-0f6b3d7b9a10";
    expect(screenshotKey(id, id)).toBe(`scans/${id}/${id}/screenshot.png`);
    expect(() => screenshotKey("../../etc", id)).toThrow();
    expect(() => screenshotKey(id, "x/../../y")).toThrow();
  });
});
