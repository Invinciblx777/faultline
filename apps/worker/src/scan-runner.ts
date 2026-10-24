import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import {
  checkScanTarget,
  conditionsFor,
  scenarioConfigSchema,
  type ExecutionRole,
  type ScanEnvironment,
} from "@faultline/shared";
import type { WorkerEnv } from "@faultline/shared/env";
import {
  artifacts,
  claimScan,
  executionEvents,
  finishScan,
  heartbeatScan,
  projects,
  scanExecutions,
  screenshotKey,
  type ArtifactStorage,
  type Database,
} from "@faultline/db";
import { runBlastRadiusAnalysis } from "./blast-radius-runner";
import { runExecution, type ExecutionLimits, type ExecutionResult } from "./executor";
import { browserLaunchOptions, type RuntimeInfo } from "./runtime";

export interface RunnerDeps {
  db: Database;
  storage: ArtifactStorage;
  env: WorkerEnv;
  runtime: RuntimeInfo;
  log?: (message: string, extra?: Record<string, unknown>) => void;
  heartbeatIntervalMs?: number;
  /** Override for tests; defaults to launching Playwright Chromium with the configured options. */
  launchBrowser?: () => Promise<Browser>;
}

export function limitsFromEnv(env: WorkerEnv): ExecutionLimits {
  return {
    navigationTimeoutMs: env.FAULTLINE_NAVIGATION_TIMEOUT_MS,
    settleTimeoutMs: env.FAULTLINE_SETTLE_TIMEOUT_MS,
    scenarioTimeoutMs: env.FAULTLINE_SCENARIO_TIMEOUT_MS,
    maxRedirects: env.FAULTLINE_MAX_REDIRECTS,
    maxRequests: env.FAULTLINE_MAX_REQUESTS,
    maxTransferBytes: env.FAULTLINE_MAX_TRANSFER_BYTES,
    maxScreenshotHeight: env.FAULTLINE_MAX_SCREENSHOT_HEIGHT,
  };
}

function environmentFor(env: WorkerEnv, runtime: RuntimeInfo, browser: Browser | null): ScanEnvironment {
  const limits = limitsFromEnv(env);
  return {
    workerVersion: runtime.workerVersion,
    workerId: runtime.workerId,
    playwrightVersion: runtime.playwrightVersion,
    browserName: browser?.browserType().name() ?? "chromium",
    browserVersion: browser?.version() ?? runtime.browserVersion ?? "unknown",
    headless: true,
    chromiumSandbox: env.FAULTLINE_CHROMIUM_SANDBOX,
    deploymentMode: env.FAULTLINE_DEPLOYMENT_MODE,
    egress: {
      guard: "faultline-egress-proxy",
      subresourcePolicy: env.FAULTLINE_SUBRESOURCE_POLICY,
      privateNetworkAccess: env.FAULTLINE_DEPLOYMENT_MODE === "public" ? "denied" : "allowlisted-only",
    },
    limits: {
      navigationTimeoutMs: limits.navigationTimeoutMs,
      scenarioTimeoutMs: limits.scenarioTimeoutMs,
      settleTimeoutMs: limits.settleTimeoutMs,
      maxRedirects: limits.maxRedirects,
      maxRequests: limits.maxRequests,
      maxTransferBytes: limits.maxTransferBytes,
    },
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.version,
  };
}

async function persistEvents(db: Database, executionId: string, result: ExecutionResult) {
  const rows = result.events.map((event) => ({
    executionId,
    seq: event.seq,
    kind: event.kind,
    severity: event.severity,
    occurredAt: new Date(event.occurredAt),
    offsetMs: event.offsetMs,
    message: event.message,
    url: event.url ?? null,
    resourceType: event.resourceType ?? null,
    method: event.method ?? null,
    statusCode: event.statusCode ?? null,
    detail: event.detail ?? null,
  }));
  for (let i = 0; i < rows.length; i += 250) {
    await db.insert(executionEvents).values(rows.slice(i, i + 250));
  }
}

/**
 * Executes one scan job end to end. Every state change is persisted as it
 * happens so a crash leaves an accurate partial record rather than a fabricated one.
 */
export async function runScan(deps: RunnerDeps, scanId: string, jobSignal?: AbortSignal): Promise<void> {
  const { db, storage, env, runtime } = deps;
  const log = deps.log ?? (() => undefined);
  const scan = await claimScan(db, scanId, runtime.workerId);
  if (!scan) {
    log("scan not claimable (already cancelled or handled)", { scanId });
    return;
  }
  log("scan claimed", { scanId });

  const cancel = new AbortController();
  const onJobAbort = () => cancel.abort();
  jobSignal?.addEventListener("abort", onJobAbort, { once: true });
  let phase = "Starting browser";
  const heartbeat = setInterval(() => {
    void heartbeatScan(db, scanId, phase, runtime.workerId)
      .then((state) => {
        if (state.cancelRequested && !cancel.signal.aborted) {
          log("cancellation requested", { scanId });
          cancel.abort();
        } else if (!state.running && !cancel.signal.aborted) {
          // The scan was finalized elsewhere (e.g. marked interrupted by a stale sweep); stop working on it.
          log("scan no longer owned by this worker; stopping", { scanId });
          cancel.abort();
        }
      })
      .catch((error: Error) => log("heartbeat failed", { scanId, error: error.message }));
  }, deps.heartbeatIntervalMs ?? 3_000);
  const setPhase = (p: string) => {
    phase = p;
  };

  let browser: Browser | null = null;
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, scan.projectId));
    if (!project) {
      await finishScan(db, scanId, { status: "failed", errorCode: "project_missing", errorMessage: "The project no longer exists." });
      return;
    }
    // Re-check authorization at execution time: the allowlist may have changed since the scan was queued.
    const check = checkScanTarget(scan.targetUrl, project.origin, env.FAULTLINE_SCAN_ALLOWLIST);
    if (!check.ok) {
      await finishScan(db, scanId, { status: "failed", errorCode: "target_not_authorized", errorMessage: check.message });
      return;
    }
    const scenario = scenarioConfigSchema.parse(scan.scenarioConfig);

    browser = await (deps.launchBrowser ?? (() => chromium.launch(browserLaunchOptions(env))))();
    const policy = {
      mode: env.FAULTLINE_DEPLOYMENT_MODE,
      allowlist: env.FAULTLINE_SCAN_ALLOWLIST,
      subresourcePolicy: env.FAULTLINE_SUBRESOURCE_POLICY,
    };
    const limits = limitsFromEnv(env);

    if (scenario.kind === "blast-radius") {
      const { cancelled } = await runBlastRadiusAnalysis({
        db,
        storage,
        env,
        scan,
        origin: project.origin,
        browser,
        policy,
        limits,
        signal: cancel.signal,
        setPhase,
        log,
      });
      const environment = environmentFor(env, runtime, browser);
      if (cancelled || cancel.signal.aborted) {
        await finishScan(db, scanId, { status: "cancelled", errorCode: "cancelled", errorMessage: "Cancelled by operator.", environment });
      } else {
        await finishScan(db, scanId, { status: "completed", environment });
      }
      return;
    }

    const roles: Array<Extract<ExecutionRole, "baseline" | "fault">> = ["baseline", "fault"];
    let allCompleted = true;

    for (const role of roles) {
      const conditions = conditionsFor(scenario, role);
      if (cancel.signal.aborted) {
        await db.insert(scanExecutions).values({ scanId, role, status: "skipped", conditions, requestedUrl: check.target.url, failureMessage: "Scan cancelled before this execution started." });
        allCompleted = false;
        continue;
      }
      const [execution] = await db
        .insert(scanExecutions)
        .values({ scanId, role, status: "running", conditions, requestedUrl: check.target.url, startedAt: new Date() })
        .returning();
      if (!execution) throw new Error("Failed to create execution record");
      const roleLabel = role === "baseline" ? "normal conditions" : "fault conditions";
      setPhase(`Running under ${roleLabel}`);

      let result: ExecutionResult;
      try {
        result = await runExecution({
          browser,
          targetUrl: check.target.url,
          conditions,
          policy,
          limits,
          signal: cancel.signal,
          onPhase: (p) => setPhase(`${role === "baseline" ? "Normal" : "Fault"}: ${p}`),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
        await db
          .update(scanExecutions)
          .set({ status: "failed", failureMessage: message, finishedAt: new Date() })
          .where(eq(scanExecutions.id, execution.id));
        throw error;
      }

      setPhase(`Saving evidence (${roleLabel})`);
      await persistEvents(db, execution.id, result);
      if (result.screenshot) {
        const key = screenshotKey(scanId, execution.id);
        const stored = await storage.put(key, result.screenshot.buffer, "image/png");
        if (stored.sha256 !== result.screenshot.sha256) throw new Error("Screenshot hash mismatch after upload");
        await db.insert(artifacts).values({
          scanId,
          executionId: execution.id,
          kind: "screenshot",
          storageKey: key,
          contentType: "image/png",
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          width: result.screenshot.width,
          height: result.screenshot.height,
        });
      }
      const cancelled = result.interrupted === "cancelled";
      if (cancelled) allCompleted = false;
      await db
        .update(scanExecutions)
        .set({
          status: cancelled ? "failed" : "completed",
          outcome: cancelled ? null : result.outcome,
          failureMessage: cancelled ? "Cancelled by operator during execution." : null,
          finalUrl: result.finalUrl,
          httpStatus: result.httpStatus,
          pageTitle: result.pageTitle,
          navigationError: result.navigationError,
          browserName: result.browserName,
          browserVersion: result.browserVersion,
          userAgent: result.userAgent,
          viewport: result.viewport,
          summary: result.summary,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs: result.durationMs,
        })
        .where(eq(scanExecutions.id, execution.id));
      log("execution finished", { scanId, role, outcome: result.outcome, events: result.events.length });
    }

    const environment = environmentFor(env, runtime, browser);
    if (cancel.signal.aborted) {
      await finishScan(db, scanId, { status: "cancelled", errorCode: "cancelled", errorMessage: "Cancelled by operator.", environment });
    } else {
      await finishScan(db, scanId, allCompleted ? { status: "completed", environment } : { status: "failed", errorCode: "incomplete", errorMessage: "Not every execution completed.", environment });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    log("scan failed", { scanId, error: message });
    const isLaunch = /browserType\.launch|Executable doesn't exist|Failed to launch/i.test(message);
    await finishScan(db, scanId, {
      status: "failed",
      errorCode: isLaunch ? "browser_launch_failed" : "worker_error",
      errorMessage: isLaunch ? `Chromium could not be launched: ${message}` : message.slice(0, 1000),
      environment: environmentFor(env, runtime, browser),
    }).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
    jobSignal?.removeEventListener("abort", onJobAbort);
    await browser?.close().catch(() => undefined);
  }
}
