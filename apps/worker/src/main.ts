import { eq } from "drizzle-orm";
import { chromium } from "playwright";
import { ConfigError, parseEnv, workerEnvSchema, type WorkerEnv } from "@faultline/shared/env";
import {
  ArtifactStorage,
  createBoss,
  createDatabase,
  ensureScanQueue,
  failStaleScans,
  SCAN_QUEUE,
  SCAN_STALE_AFTER_MS,
  storageConfigFromEnv,
  workerInstances,
  type ScanJobData,
} from "@faultline/db";
import { fileURLToPath } from "node:url";
import { DevinClient, devinConfigFromEnv, GitHubClient } from "@faultline/shared/integrations";
import { cleanupStaleCandidates, runtimeAvailable, type CandidateSettings } from "./repair/candidate";
import { startRepairSupervisor } from "./repair/supervisor";
import { browserLaunchOptions, createRuntimeInfo } from "./runtime";
import { runScan } from "./scan-runner";

function log(message: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level: "info", msg: message, ...extra };
  console.log(JSON.stringify(line));
}

function loadEnv(): WorkerEnv {
  try {
    return parseEnv(workerEnvSchema);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function main() {
  const env = loadEnv();
  if (env.FAULTLINE_DEPLOYMENT_MODE === "public" && !env.FAULTLINE_NETWORK_ISOLATION_ACK) {
    console.error(
      "Refusing to start in public mode: set FAULTLINE_NETWORK_ISOLATION_ACK=true only after the worker's network egress is isolated at the OS/network level (see docs/security.md).",
    );
    process.exit(1);
  }
  if (env.FAULTLINE_SCAN_ALLOWLIST.length === 0) {
    log("FAULTLINE_SCAN_ALLOWLIST is empty: every scan will be refused until an origin is authorized");
  }

  const runtime = createRuntimeInfo();

  // Preflight: prove Chromium launches with the configured sandbox setting before taking jobs.
  const probe = await chromium.launch(browserLaunchOptions(env));
  runtime.browserVersion = probe.version();
  await probe.close();
  log("chromium preflight ok", { version: runtime.browserVersion, sandbox: env.FAULTLINE_CHROMIUM_SANDBOX });

  const database = createDatabase(env.DATABASE_URL, { max: env.FAULTLINE_WORKER_CONCURRENCY + 3, applicationName: "faultline-worker" });
  const storage = new ArtifactStorage(storageConfigFromEnv(env));
  await storage.ensureBucket();
  log("artifact storage ready", { bucket: storage.bucket });

  const boss = createBoss(env.DATABASE_URL, "faultline-worker");
  boss.on("error", (error) => log("pg-boss error", { error: error.message }));
  await boss.start();
  await ensureScanQueue(boss);

  await database.db.insert(workerInstances).values({
    id: runtime.workerId,
    version: runtime.workerVersion,
    hostname: runtime.hostname,
    browserName: "chromium",
    browserVersion: runtime.browserVersion,
    playwrightVersion: runtime.playwrightVersion,
    deploymentMode: env.FAULTLINE_DEPLOYMENT_MODE,
    concurrency: env.FAULTLINE_WORKER_CONCURRENCY,
  });

  const heartbeat = setInterval(() => {
    void database.db
      .update(workerInstances)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(workerInstances.id, runtime.workerId))
      .catch((error: Error) => log("worker heartbeat failed", { error: error.message }));
  }, 10_000);

  const sweep = async () => {
    try {
      const failed = await failStaleScans(database.db, SCAN_STALE_AFTER_MS);
      if (failed.length) log("marked interrupted scans as failed", { scanIds: failed.map((f) => f.id) });
    } catch (error) {
      log("stale scan sweep failed", { error: (error as Error).message });
    }
  };
  await sweep();
  const sweeper = setInterval(() => void sweep(), 30_000);

  await boss.work<ScanJobData>(SCAN_QUEUE, { localConcurrency: env.FAULTLINE_WORKER_CONCURRENCY, batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const job of jobs) {
      if (typeof job.data?.scanId !== "string") {
        log("ignoring malformed job", { jobId: job.id });
        continue;
      }
      await runScan({ db: database.db, storage, env, runtime, log }, job.data.scanId, job.signal);
    }
  });
  // Verified Repair: optional. Without Devin credentials the loop still verifies nothing it was not asked to.
  const devinConfig = devinConfigFromEnv(process.env);
  const devin = devinConfig.configured ? new DevinClient({ apiKey: devinConfig.apiKey, orgId: devinConfig.orgId, baseUrl: devinConfig.baseUrl }) : null;
  const github = new GitHubClient({ token: env.GITHUB_TOKEN ?? null });
  const candidateSettings: CandidateSettings = {
    runtime: env.FAULTLINE_CONTAINER_RUNTIME,
    image: env.FAULTLINE_VERIFY_IMAGE,
    network: env.FAULTLINE_VERIFY_NETWORK,
    basePort: env.FAULTLINE_VERIFY_BASE_PORT,
    workRoot: fileURLToPath(new URL("../.verification-runs", import.meta.url)),
    maxArchiveBytes: 50 * 1024 * 1024,
    startTimeoutMs: 30_000,
  };
  const containerRuntime = await runtimeAvailable(candidateSettings);
  if (containerRuntime.ok) await cleanupStaleCandidates(candidateSettings, log);
  log("repair integration", {
    devin: devinConfig.configured ? "configured" : `unavailable: ${devinConfig.reason}`,
    github: github.hasToken ? "token set" : "no token (public repositories only)",
    containerRuntime: containerRuntime.ok ? containerRuntime.version : containerRuntime.reason,
    repositories: env.FAULTLINE_REPAIR_REPOSITORIES,
  });
  const supervisor = startRepairSupervisor({
    pollIntervalMs: env.FAULTLINE_DEVIN_POLL_INTERVAL_MS,
    agent: {
      db: database.db,
      storage,
      devin,
      devinUnavailable: devinConfig.configured ? null : devinConfig.reason,
      github,
      workerId: runtime.workerId,
      maxAcuLimit: env.DEVIN_MAX_ACU_LIMIT || null,
      attachScreenshots: env.FAULTLINE_DEVIN_ATTACH_SCREENSHOTS,
      log,
    },
    verification: { db: database.db, storage, env, github, workerId: runtime.workerId, settings: candidateSettings, log },
  });

  log("worker ready", {
    workerId: runtime.workerId,
    concurrency: env.FAULTLINE_WORKER_CONCURRENCY,
    mode: env.FAULTLINE_DEPLOYMENT_MODE,
    allowlist: env.FAULTLINE_SCAN_ALLOWLIST.map((e) => e.source),
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("shutting down", { signal });
    clearInterval(heartbeat);
    clearInterval(sweeper);
    await supervisor.stop();
    await boss.stop({ graceful: true, timeout: 30_000 }).catch(() => undefined);
    await database.db
      .update(workerInstances)
      .set({ stoppedAt: new Date() })
      .where(eq(workerInstances.id, runtime.workerId))
      .catch(() => undefined);
    await database.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("worker failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
