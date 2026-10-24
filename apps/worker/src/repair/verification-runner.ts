import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import {
  blastRadiusConfigSchema,
  decideVerification,
  findAllowlistMatch,
  journeyDefinitionSchema,
  retargetFault,
  sanitizeEvidenceText,
  verificationSupportsFault,
  type CheckStatus,
  type ExperimentFault,
  type JourneyDefinition,
  type VerificationInputs,
} from "@faultline/shared";
import { sha256Hex } from "@faultline/shared/checksum";
import type { EgressPolicy } from "@faultline/shared/network";
import type { WorkerEnv } from "@faultline/shared/env";
import type { GitHubClient } from "@faultline/shared/integrations";
import {
  experiments,
  finishVerification,
  heartbeatVerification,
  projects,
  recordRepairEvent,
  regressionTests,
  repairRequests,
  scans,
  sourceRepositories,
  verificationArtifactKey,
  verificationChecks,
  type ArtifactStorage,
  type Database,
  type VerificationRun,
  type VerificationStage,
} from "@faultline/db";
import { JOURNEY_VIEWPORTS, runJourneyExecution } from "../journey-executor";
import { validateRegressionTest } from "../regression-validator";
import { browserLaunchOptions } from "../runtime";
import { limitsFromEnv } from "../scan-runner";
import { CandidateError, runtimeAvailable, startCandidate, type CandidateSettings, type CandidateSpec, type RunningCandidate } from "./candidate";

export interface VerificationDeps {
  db: Database;
  storage: ArtifactStorage;
  env: WorkerEnv;
  github: GitHubClient;
  workerId: string;
  settings: CandidateSettings;
  log: (message: string, extra?: Record<string, unknown>) => void;
  heartbeatIntervalMs?: number;
  /** Test seams; production uses Playwright Chromium and the container runner. */
  launchBrowser?: () => Promise<Browser>;
  startCandidate?: (spec: CandidateSpec) => Promise<RunningCandidate>;
  checkRuntime?: () => Promise<{ ok: true; version: string } | { ok: false; reason: string }>;
}

/** Regression-test attempts per revision. Every attempt must agree for a non-inconclusive verdict. */
export const FAULT_ATTEMPTS = 2;

interface CheckContext {
  deps: VerificationDeps;
  run: VerificationRun;
  repairId: string;
  ordinal: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

async function insertCheck(ctx: CheckContext, values: { stage: VerificationStage; revision: "original" | "candidate"; sha: string; targetOrigin: string; method: "regression-test" | "journey"; purpose: "verdict" | "evidence"; attempt: number; faultApplied: boolean }) {
  ctx.ordinal += 1;
  const [row] = await ctx.deps.db
    .insert(verificationChecks)
    .values({ runId: ctx.run.id, ordinal: ctx.ordinal, ...values, status: "running", startedAt: new Date() })
    .returning();
  return row!;
}

async function finishCheck(ctx: CheckContext, id: string, started: number, values: Partial<typeof verificationChecks.$inferInsert> & { status: CheckStatus }) {
  await ctx.deps.db
    .update(verificationChecks)
    .set({ ...values, finishedAt: new Date(), durationMs: Date.now() - started })
    .where(eq(verificationChecks.id, id));
}

async function skipCheck(ctx: CheckContext, values: Parameters<typeof insertCheck>[1], reason: string) {
  ctx.ordinal += 1;
  await ctx.deps.db.insert(verificationChecks).values({ runId: ctx.run.id, ordinal: ctx.ordinal, ...values, status: "skipped", summary: reason, finishedAt: new Date() });
}

/** Runs the stored regression test, byte for byte, with Playwright Test against one origin. */
async function regressionCheck(ctx: CheckContext, input: { stage: VerificationStage; candidate: RunningCandidate; attempt: number; test: { filename: string; content: string }; policy: EgressPolicy }): Promise<CheckStatus> {
  const check = await insertCheck(ctx, { stage: input.stage, revision: input.candidate.label, sha: input.candidate.sha, targetOrigin: input.candidate.origin, method: "regression-test", purpose: "verdict", attempt: input.attempt, faultApplied: true });
  const started = Date.now();
  try {
    const result = await validateRegressionTest({
      filename: input.test.filename,
      content: input.test.content,
      targetOrigin: input.candidate.origin,
      policy: input.policy,
      maxTransferBytes: ctx.deps.env.FAULTLINE_MAX_TRANSFER_BYTES,
      chromiumSandbox: ctx.deps.env.FAULTLINE_CHROMIUM_SANDBOX,
      timeoutMs: 180_000,
    });
    const status: CheckStatus = result.status === "passes" ? "passed" : result.status === "fails_as_expected" ? "failed" : "error";
    const summary =
      status === "passed"
        ? `Passed against ${input.candidate.label} ${input.candidate.sha.slice(0, 12)} (${input.candidate.origin}).`
        : status === "failed"
          ? result.summary.replace("reproducing the finding", "the finding is present")
          : result.summary;
    await finishCheck(ctx, check.id, started, { status, summary: sanitizeEvidenceText(summary, 1000), output: result.output });
    return status;
  } catch (error) {
    await finishCheck(ctx, check.id, started, { status: "error", summary: `The test runner could not run: ${sanitizeEvidenceText(errorText(error), 500)}` });
    return "error";
  }
}

/**
 * Runs the journey with the engine used by Blast Radius. With no fault it
 * decides whether the steps that were stable in the original analysis still
 * pass; with the fault it records screenshots and errors as evidence.
 */
async function journeyCheck(
  ctx: CheckContext,
  input: {
    stage: VerificationStage;
    purpose: "verdict" | "evidence";
    candidate: RunningCandidate;
    journey: JourneyDefinition;
    stableSteps: number[];
    fault: ExperimentFault | null;
    viewport: (typeof JOURNEY_VIEWPORTS)["desktop"];
    browser: Browser;
    policy: EgressPolicy;
  },
): Promise<CheckStatus> {
  const check = await insertCheck(ctx, {
    stage: input.stage,
    revision: input.candidate.label,
    sha: input.candidate.sha,
    targetOrigin: input.candidate.origin,
    method: "journey",
    purpose: input.purpose,
    attempt: 1,
    faultApplied: input.fault !== null,
  });
  const started = Date.now();
  try {
    const result = await runJourneyExecution({
      browser: input.browser,
      origin: input.candidate.origin,
      journey: input.journey,
      fault: input.fault,
      viewport: input.viewport,
      policy: input.policy,
      limits: limitsFromEnv(ctx.deps.env),
    });
    let screenshot: Pick<Partial<typeof verificationChecks.$inferInsert>, "screenshotKey" | "screenshotSha256" | "screenshotBytes" | "screenshotWidth" | "screenshotHeight"> = {};
    if (result.screenshot) {
      const key = verificationArtifactKey(ctx.repairId, ctx.run.id, check.id);
      const stored = await ctx.deps.storage.put(key, result.screenshot.buffer, "image/png");
      if (stored.sha256 !== result.screenshot.sha256) throw new Error("Screenshot hash mismatch after upload");
      screenshot = { screenshotKey: key, screenshotSha256: stored.sha256, screenshotBytes: stored.byteSize, screenshotWidth: result.screenshot.width, screenshotHeight: result.screenshot.height };
    }
    const steps = result.steps.map((s) => ({ index: s.index, description: sanitizeEvidenceText(s.description, 200), status: s.status, error: s.error ? sanitizeEvidenceText(s.error, 400) : null, durationMs: s.durationMs }));
    const errors = result.events
      .filter((e) => (e.kind === "console" && e.severity === "error") || e.kind === "page_error" || ((e.kind === "request_failed" || e.kind === "http_error") && !(e.detail as { consequenceOfFaultInjection?: boolean } | undefined)?.consequenceOfFaultInjection))
      .slice(0, 25)
      .map((e) => ({ kind: e.kind, message: sanitizeEvidenceText(e.url ? `${e.message} · ${e.url}` : e.message, 400) }));
    const failing = input.stableSteps.filter((i) => result.observation.steps[i]?.status !== "passed");
    let status: CheckStatus;
    let summary: string;
    if (result.engineError) {
      status = "error";
      summary = `The journey engine failed: ${sanitizeEvidenceText(result.engineError, 400)}`;
    } else if (failing.length === 0) {
      status = "passed";
      summary = `All ${input.stableSteps.length} replayed journey steps passed${input.fault ? " under the fault" : " under normal conditions"}.`;
    } else {
      status = "failed";
      const first = steps.find((s) => s.index === failing[0]);
      summary = `Step ${failing[0]! + 1} ${first?.status === "not_reached" ? "was not reached" : "failed"}${input.fault ? " under the fault" : " under normal conditions"}${first?.error ? `: ${first.error}` : "."}`;
    }
    await finishCheck(ctx, check.id, started, { status, summary, steps, errors, faultApplications: input.fault ? result.observation.faultApplications : null, ...screenshot });
    return status;
  } catch (error) {
    await finishCheck(ctx, check.id, started, { status: "error", summary: `The journey could not run: ${sanitizeEvidenceText(errorText(error), 500)}` });
    return "error";
  }
}

/**
 * Independent verification of one candidate commit.
 *
 *   A. original revision, normal conditions  → the baseline must be valid
 *   B. original revision, same fault (×2)    → the failure must reproduce
 *   C. candidate commit, same fault (×2)     → the unchanged test must pass
 *   D. candidate commit, normal conditions   → no regression
 *
 * Fault evidence runs (screenshots, errors) are recorded for B and C but
 * never decide the verdict. Every check is persisted as it finishes.
 */
export async function runVerification(deps: VerificationDeps, run: VerificationRun): Promise<void> {
  const { db, env, log } = deps;
  const [repair] = await db.select().from(repairRequests).where(eq(repairRequests.id, run.repairId));
  if (!repair) return;
  const ctx: CheckContext = { deps, run, repairId: repair.id, ordinal: 0 };
  let phase = "Preparing";
  let owned = true;
  const heartbeat = setInterval(() => {
    void heartbeatVerification(db, run.id, deps.workerId, phase)
      .then((ok) => {
        if (!ok) owned = false;
      })
      .catch(() => undefined);
  }, deps.heartbeatIntervalMs ?? 5_000);
  const setPhase = (p: string) => {
    phase = p;
  };

  const builds: Record<string, unknown> = {};
  const inputs: VerificationInputs = {
    testIntegrity: { ok: false, detail: "not checked" },
    original: { build: { ok: false, detail: "not started" }, normal: "skipped", fault: [] },
    candidate: { build: { ok: false, detail: "not started" }, identity: { ok: false, detail: "not started" }, fault: [], normal: "skipped" },
  };
  let browser: Browser | null = null;
  const running: RunningCandidate[] = [];
  const blocked = async (reason: string) => {
    const decision = { verdict: "verification_blocked" as const, rationale: [reason] };
    await finishVerification(db, run.id, deps.workerId, { ...decision, builds });
    await recordRepairEvent(db, repair.id, { source: "verification", kind: "verdict", message: `Verification blocked: ${reason}`, detail: { runId: run.id, verdict: decision.verdict } });
    log("verification blocked", { runId: run.id, reason });
  };

  await recordRepairEvent(db, repair.id, { source: "verification", kind: "verification_started", message: `Independent verification started for commit ${run.candidateSha.slice(0, 12)} (original ${run.originalSha.slice(0, 12)}).`, detail: { runId: run.id } });
  try {
    const [repo] = await db.select().from(sourceRepositories).where(eq(sourceRepositories.id, repair.repositoryId));
    const [test] = await db.select().from(regressionTests).where(eq(regressionTests.id, repair.regressionTestId));
    const [experiment] = await db.select().from(experiments).where(eq(experiments.id, repair.experimentId));
    const [scan] = await db.select().from(scans).where(eq(scans.id, repair.scanId));
    const [project] = scan ? await db.select().from(projects).where(eq(projects.id, scan.projectId)) : [];
    if (!repo || !test || !experiment || !scan || !project || !scan.journeySnapshot || !scan.analysis) return await blocked("The repair's repository, regression test, finding, or analysis record is missing.");

    // The test must be byte-for-byte the one recorded when the repair was created.
    const contentSha = sha256Hex(test.content);
    const integrityOk = contentSha === test.sha256 && contentSha === repair.regressionTestSha256 && contentSha === run.regressionTestSha256;
    inputs.testIntegrity = { ok: integrityOk, detail: integrityOk ? `${test.filename} unchanged (SHA-256 ${contentSha.slice(0, 16)}…).` : `content hash ${contentSha.slice(0, 16)}… does not match the recorded ${repair.regressionTestSha256.slice(0, 16)}….` };
    if (!integrityOk) return await finish();

    const support = verificationSupportsFault(experiment.fault, project.origin);
    if (!support.ok) return await blocked(support.reason);
    const journey = journeyDefinitionSchema.parse(scan.journeySnapshot.definition);
    const config = blastRadiusConfigSchema.parse(scan.scenarioConfig);
    const viewport = JOURNEY_VIEWPORTS[config.viewport];
    const stableSteps = scan.analysis.stableSteps;

    setPhase("Confirming commits with GitHub");
    try {
      await deps.github.getCommit(repo.owner, repo.name, run.originalSha);
      await deps.github.getCommit(repo.owner, repo.name, run.candidateSha);
      const pull = await deps.github.getPullRequest(repo.owner, repo.name, run.prNumber);
      builds.pullRequestAtStart = { number: pull.number, headSha: pull.headSha, state: pull.merged ? "merged" : pull.state };
      if (pull.headSha !== run.candidateSha) {
        await recordRepairEvent(db, repair.id, { source: "verification", kind: "note", message: `The pull request head is now ${pull.headSha.slice(0, 12)}; this run verifies ${run.candidateSha.slice(0, 12)}, the commit it was queued for.` });
      }
    } catch (error) {
      return await blocked(`GitHub could not confirm the commits: ${errorText(error)}`);
    }

    const runtime = await (deps.checkRuntime ?? (() => runtimeAvailable(deps.settings)))();
    if (!runtime.ok) return await blocked(runtime.reason);
    builds.runtime = runtime.version;

    const ports = [deps.settings.basePort, ...repo.recipe.extraPortEnvs.map((_, i) => deps.settings.basePort + i + 1)];
    const notAllowed = ports.map((p) => `http://localhost:${p}`).filter((o) => !findAllowlistMatch(o, env.FAULTLINE_SCAN_ALLOWLIST));
    if (notAllowed.length) return await blocked(`Candidate origins must be authorized: add ${notAllowed.join(",")} to FAULTLINE_SCAN_ALLOWLIST (the worker runs candidates only on those loopback ports).`);
    const policy: EgressPolicy = { mode: env.FAULTLINE_DEPLOYMENT_MODE, allowlist: env.FAULTLINE_SCAN_ALLOWLIST, subresourcePolicy: env.FAULTLINE_SUBRESOURCE_POLICY };
    browser = await (deps.launchBrowser ?? (() => chromium.launch(browserLaunchOptions(env))))();

    const start = async (label: "original" | "candidate", sha: string) => {
      setPhase(`Building ${label} ${sha.slice(0, 12)} in an isolated container`);
      const spec: CandidateSpec = { runId: run.id, label, owner: repo.owner, name: repo.name, sha, appDir: repo.appDir, recipe: repo.recipe };
      const candidate = await (deps.startCandidate ?? ((s) => startCandidate(s, deps.settings, deps.github)))(spec);
      running.push(candidate);
      builds[label] = {
        sha: candidate.sha,
        origin: candidate.origin,
        extraOrigins: candidate.extraOrigins,
        archiveSha256: candidate.archiveSha256,
        archiveBytes: candidate.archiveBytes,
        archiveRoot: candidate.archiveRoot,
        container: candidate.containerName,
        containerId: candidate.containerId,
        image: candidate.image,
        imageId: candidate.imageId,
        identity: candidate.identity,
      };
      await recordRepairEvent(db, repair.id, { source: "verification", kind: "build", message: `${label === "original" ? "Original" : "Candidate"} ${sha.slice(0, 12)} is running at ${candidate.origin}. ${candidate.identity.join(" ")}`, detail: { runId: run.id } });
      return candidate;
    };
    const stopCandidate = async (candidate: RunningCandidate) => {
      await candidate.stop();
      running.splice(running.indexOf(candidate), 1);
    };
    const checkOwned = () => {
      if (!owned) throw new Error("This verification is no longer owned by this worker.");
    };

    // A + B: the original revision.
    let original: RunningCandidate;
    try {
      original = await start("original", run.originalSha);
      inputs.original.build = { ok: true, detail: `built from ${run.originalSha.slice(0, 12)}` };
    } catch (error) {
      inputs.original.build = { ok: false, detail: errorText(error) };
      return await finish();
    }
    const faultOn = (candidate: RunningCandidate) => retargetFault(experiment.fault, project.origin, candidate.origin);
    setPhase("Original revision: journey under normal conditions");
    inputs.original.normal = await journeyCheck(ctx, { stage: "original-normal", purpose: "verdict", candidate: original, journey, stableSteps, fault: null, viewport, browser, policy });
    checkOwned();
    for (let attempt = 1; attempt <= FAULT_ATTEMPTS; attempt++) {
      setPhase(`Original revision: regression test under the fault (${attempt}/${FAULT_ATTEMPTS})`);
      inputs.original.fault.push(await regressionCheck(ctx, { stage: "original-fault", candidate: original, attempt, test, policy }));
      checkOwned();
    }
    setPhase("Original revision: evidence under the fault");
    await journeyCheck(ctx, { stage: "original-fault-evidence", purpose: "evidence", candidate: original, journey, stableSteps, fault: faultOn(original), viewport, browser, policy });
    await stopCandidate(original);
    checkOwned();

    const reproduced = inputs.original.normal === "passed" && inputs.original.fault.length > 0 && inputs.original.fault.every((s) => s === "failed");
    if (!reproduced) {
      const reason = "Not run: the original failure was not reproduced against a valid baseline, so a candidate result could not support a verdict.";
      for (const [stage, method, purpose, faultApplied] of [
        ["candidate-fault", "regression-test", "verdict", true],
        ["candidate-fault-evidence", "journey", "evidence", true],
        ["candidate-normal", "journey", "verdict", false],
      ] as const) {
        await skipCheck(ctx, { stage, revision: "candidate", sha: run.candidateSha, targetOrigin: "", method, purpose, attempt: 1, faultApplied }, reason);
      }
      return await finish();
    }

    // C + D: the candidate commit.
    let candidate: RunningCandidate;
    try {
      candidate = await start("candidate", run.candidateSha);
      inputs.candidate.build = { ok: true, detail: `built from ${run.candidateSha.slice(0, 12)}` };
      inputs.candidate.identity = candidate.sha === run.candidateSha ? { ok: true, detail: candidate.identity.join(" ") } : { ok: false, detail: `running ${candidate.sha}, expected ${run.candidateSha}` };
    } catch (error) {
      inputs.candidate.build = { ok: false, detail: errorText(error) };
      return await finish();
    }
    for (let attempt = 1; attempt <= FAULT_ATTEMPTS; attempt++) {
      setPhase(`Candidate: regression test under the fault (${attempt}/${FAULT_ATTEMPTS})`);
      inputs.candidate.fault.push(await regressionCheck(ctx, { stage: "candidate-fault", candidate, attempt, test, policy }));
      checkOwned();
    }
    setPhase("Candidate: evidence under the fault");
    await journeyCheck(ctx, { stage: "candidate-fault-evidence", purpose: "evidence", candidate, journey, stableSteps, fault: faultOn(candidate), viewport, browser, policy });
    checkOwned();
    setPhase("Candidate: journey under normal conditions");
    inputs.candidate.normal = await journeyCheck(ctx, { stage: "candidate-normal", purpose: "verdict", candidate, journey, stableSteps, fault: null, viewport, browser, policy });
    await stopCandidate(candidate);
    return await finish();
  } catch (error) {
    const message = error instanceof CandidateError ? error.message : errorText(error);
    log("verification failed", { runId: run.id, error: message });
    if (owned) {
      await finishVerification(db, run.id, deps.workerId, { verdict: "verification_blocked", rationale: [`Verification stopped: ${sanitizeEvidenceText(message, 500)}`], builds, errorMessage: sanitizeEvidenceText(message, 1000) });
      await recordRepairEvent(db, repair.id, { source: "verification", kind: "verdict", message: `Verification blocked: ${sanitizeEvidenceText(message, 500)}`, detail: { runId: run.id } });
    }
  } finally {
    clearInterval(heartbeat);
    for (const candidate of [...running]) await candidate.stop().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  async function finish() {
    const decision = decideVerification(inputs);
    builds.inputs = inputs;
    const saved = await finishVerification(db, run.id, deps.workerId, { ...decision, builds });
    if (!saved) {
      log("verification result not saved (run no longer owned)", { runId: run.id });
      return;
    }
    await recordRepairEvent(db, repair!.id, {
      source: "verification",
      kind: "verdict",
      message: `Verdict for ${run.candidateSha.slice(0, 12)}: ${decision.verdict.replace(/_/g, " ").toUpperCase()}. ${decision.rationale[decision.rationale.length - 1]}`,
      detail: { runId: run.id, verdict: decision.verdict, rationale: decision.rationale },
    });
    log("verification finished", { runId: run.id, verdict: decision.verdict });
  }
}
