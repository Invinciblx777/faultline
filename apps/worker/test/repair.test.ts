import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArtifactStorage,
  approveRepair,
  claimNextVerification,
  experiments,
  failStaleVerifications,
  journeys,
  loadRepairEvidenceInput,
  operators,
  projects,
  queueVerification,
  regressionTests,
  repairEvents,
  repairRequests,
  scans,
  sourceRepositories,
  storageConfigFromEnv,
  verificationChecks,
  verificationRuns,
  type DatabaseHandle,
  type SourceRepository,
} from "@faultline/db";
import { buildRepairEvidence, buildRepairPrompt, journeyDefinitionSchema, repairMarker, scenarioConfigSchema, type GitHubPullFacts } from "@faultline/shared";
import { evidenceChecksum, sha256Hex } from "@faultline/shared/checksum";
import type { WorkerEnv } from "@faultline/shared/env";
import { DevinClient, type GitHubClient } from "@faultline/shared/integrations";
import { recoverSubmissions, submitRepair, syncRepair, type RepairAgentDeps } from "../src/repair/devin-agent";
import type { CandidateSettings, CandidateSpec, RunningCandidate } from "../src/repair/candidate";
import { runVerification, type VerificationDeps } from "../src/repair/verification-runner";
import { createRuntimeInfo } from "../src/runtime";
import { runScan } from "../src/scan-runner";
import { FIXED_LOAD, REGRESSING_LOAD, startPatchedStorefront, startStorefront, type RunningServer } from "./fixtures";
import { openTestDatabase, resetTestDatabase, testEnv } from "./integration-env";

/*
 * Repair pipeline against real infrastructure: a real Blast Radius analysis
 * produces the finding and its regression test; Devin's HTTP API is stubbed
 * at the fetch layer (no credentials exist in CI); verification runs real
 * Chromium and Playwright Test against storefront builds that are fixed,
 * unfixed, or regressing. Containers are replaced by the startCandidate seam
 * and covered separately by the container test.
 */

const VERIFY_PORT = 4790;
const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const OWNER = "acme";
const NAME = "shop";

let shop: RunningServer;
let partner: RunningServer;
let env: WorkerEnv;
let handle: DatabaseHandle;
let storage: ArtifactStorage;
let operatorId: string;
let experimentId: string;
let repo: SourceRepository;
const logs: string[] = [];
const log = (message: string) => void logs.push(message);

beforeAll(async () => {
  ({ shop, partner } = await startStorefront());
  env = testEnv({ FAULTLINE_SCAN_ALLOWLIST: `${shop.origin},${partner.origin},http://localhost:${VERIFY_PORT}` });
  handle = await openTestDatabase(env);
  storage = new ArtifactStorage(storageConfigFromEnv(env));
  await storage.ensureBucket();
  await resetTestDatabase(handle);

  const [op] = await handle.db.insert(operators).values({ username: "approver", passwordHash: "scrypt$unused" }).returning();
  operatorId = op!.id;
  const [project] = await handle.db.insert(projects).values({ name: "Storefront", origin: shop.origin }).returning();
  const definition = journeyDefinitionSchema.parse({
    name: "Buy a backpack",
    steps: [
      { type: "navigate", path: "/shop/" },
      { type: "assertVisible", target: { by: "text", text: "Trail Backpack" } },
      { type: "click", target: { by: "role", role: "button", name: "Add Trail Backpack to cart" } },
      { type: "assertText", target: { by: "testId", testId: "cart-count" }, text: "1 item" },
    ],
  });
  const lineageId = randomUUID();
  const [journey] = await handle.db.insert(journeys).values({ projectId: project!.id, lineageId, version: 1, name: definition.name, definition }).returning();
  const scenario = scenarioConfigSchema.parse({ kind: "blast-radius", journeyId: journey!.id, targets: [{ dependencyKey: `endpoint GET ${shop.origin}/api/inventory`, fault: "http-error" }], confirmFindings: true });
  const [scan] = await handle.db
    .insert(scans)
    .values({ projectId: project!.id, targetUrl: `${shop.origin}/shop/`, scenarioKind: scenario.kind, scenarioConfig: scenario, journeyId: journey!.id, journeySnapshot: { id: journey!.id, lineageId, version: 1, definition } })
    .returning();
  await runScan({ db: handle.db, storage, env, runtime: { ...createRuntimeInfo(), browserVersion: null }, heartbeatIntervalMs: 500 }, scan!.id);
  const [finding] = await handle.db.select().from(experiments).where(eq(experiments.scanId, scan!.id));
  expect(finding?.verdict).toBe("broken");
  const [test] = await handle.db.select().from(regressionTests).where(eq(regressionTests.experimentId, finding!.id));
  expect(test?.validationStatus).toBe("fails_as_expected");
  experimentId = finding!.id;

  const [linked] = await handle.db
    .insert(sourceRepositories)
    .values({
      projectId: project!.id,
      provider: "github",
      owner: OWNER,
      name: NAME,
      url: `https://github.com/${OWNER}/${NAME}`,
      baseBranch: "main",
      recipe: { kind: "node-server", entry: "server.mjs", portEnv: "PORT", extraPortEnvs: [], hostEnv: null },
      githubStatus: "ok",
      baseSha: BASE_SHA,
      devinStatus: "ok",
      devinRepoName: `${OWNER}/${NAME}`,
    })
    .returning();
  repo = linked!;
}, 300_000);

afterAll(async () => {
  await handle?.close();
  await Promise.all([shop?.close(), partner?.close()]);
});

/** Closes any open repair for the finding so the next test can create one (one open repair per finding). */
async function closeOpenRepairs() {
  await handle.db.execute(sql`update repair_requests set status = 'cancelled' where experiment_id = ${experimentId} and status not in ('cancelled', 'devin_failed')`);
}

async function createRepair(extra: Partial<typeof repairRequests.$inferInsert> = {}) {
  await closeOpenRepairs();
  const id = randomUUID();
  const createdAt = new Date();
  const loaded = await loadRepairEvidenceInput(handle.db, experimentId, repo, { repairRequestId: id, createdAt, baseSha: BASE_SHA });
  if (!loaded.ok) throw new Error(loaded.error);
  const evidence = buildRepairEvidence(loaded.input);
  const prompt = buildRepairPrompt(evidence);
  const [row] = await handle.db
    .insert(repairRequests)
    .values({
      id,
      projectId: loaded.projectId,
      scanId: loaded.scanId,
      experimentId,
      repositoryId: repo.id,
      repoOwner: OWNER,
      repoName: NAME,
      baseBranch: "main",
      baseSha: BASE_SHA,
      evidence,
      evidenceSha256: evidenceChecksum(evidence),
      prompt,
      promptSha256: sha256Hex(prompt),
      regressionTestId: loaded.regressionTestId,
      regressionTestSha256: loaded.input.regressionTest.sha256,
      createdBy: operatorId,
      createdAt,
      devinTag: `faultline-repair-${id}`,
      ...extra,
    })
    .returning();
  return row!;
}

function pull(repairId: string, overrides: Partial<GitHubPullFacts> = {}): GitHubPullFacts {
  return {
    number: 12,
    htmlUrl: `https://github.com/${OWNER}/${NAME}/pull/12`,
    state: "open",
    merged: false,
    draft: false,
    title: "Tolerate inventory outages",
    body: `Keeps products visible when inventory fails.\n\n${repairMarker(repairId)}`,
    baseRef: "main",
    baseRepoFullName: `${OWNER}/${NAME}`,
    headRef: "devin/inventory-fallback",
    headSha: HEAD_SHA,
    headRepoFullName: `${OWNER}/${NAME}`,
    createdAt: "2026-10-24T18:00:00Z",
    updatedAt: "2026-10-24T18:05:00Z",
    mergedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function fakeGitHub(pullFor: (n: number) => GitHubPullFacts): GitHubClient {
  return {
    getPullRequest: async (_o: string, _n: string, number: number) => pullFor(number),
    getCommit: async (_o: string, _n: string, sha: string) => ({ sha, html_url: `https://github.com/${OWNER}/${NAME}/commit/${sha}` }),
  } as unknown as GitHubClient;
}

interface DevinCall {
  method: string;
  path: string;
  body: unknown;
}

/** Devin API v3 at the HTTP layer, with response shapes from Devin's OpenAPI document. */
function fakeDevin(behaviour: { create?: "ok" | "timeout"; sessions?: Record<string, unknown>[]; session?: () => Record<string, unknown>; messages?: Array<{ event_id: string; source: string; message: string; created_at: number }> }) {
  const calls: DevinCall[] = [];
  const sessionId = `devin-${randomUUID()}`;
  const session = (extra: Record<string, unknown> = {}) => ({
    session_id: sessionId,
    url: `https://app.devin.ai/sessions/${sessionId}`,
    status: "running",
    status_detail: "working",
    tags: ["faultline"],
    org_id: "org-test",
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    pull_requests: [],
    ...extra,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? "multipart" : null;
    calls.push({ method, path: url.pathname, body });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer cog_test_key_0123456789");
    if (method === "POST" && url.pathname.endsWith("/attachments")) return json({ attachment_id: `att-${calls.length}`, name: "shot.png", url: `https://attachments.devin.ai/att-${calls.length}` });
    if (method === "POST" && url.pathname.endsWith("/sessions")) {
      if (behaviour.create === "timeout") throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
      return json(session({ tags: (body as { tags: string[] }).tags }));
    }
    if (method === "GET" && url.pathname.endsWith("/sessions")) return json({ items: behaviour.sessions ?? [], has_next_page: false, end_cursor: null });
    if (method === "GET" && url.pathname.endsWith("/messages")) return json({ items: behaviour.messages ?? [], has_next_page: false, end_cursor: behaviour.messages?.length ? "cursor-1" : null });
    if (method === "GET" && url.pathname.includes("/sessions/")) return json(behaviour.session ? session(behaviour.session()) : session());
    return json({ title: "not found", status: 404 }, 404);
  }) as typeof fetch;
  const client = new DevinClient({ apiKey: "cog_test_key_0123456789", orgId: "org-test", baseUrl: "https://api.devin.test", fetch: impl, maxAttempts: 2, sleep: async () => undefined });
  return { client, calls, session, sessionId };
}

function agentDeps(devin: DevinClient | null, github: GitHubClient = fakeGitHub((n) => pull("", { number: n }))): RepairAgentDeps {
  return { db: handle.db, storage, devin, devinUnavailable: devin ? null : "DEVIN_API_KEY and DEVIN_ORG_ID are not set.", github, workerId: "test-worker", maxAcuLimit: null, attachScreenshots: true, log };
}

async function approve(id: string) {
  const [row] = await handle.db.select().from(repairRequests).where(eq(repairRequests.id, id));
  return approveRepair(handle.db, id, { operatorId, username: "approver", statement: "approved in test", evidenceSha256: row!.evidenceSha256 });
}

const reload = async (id: string) => (await handle.db.select().from(repairRequests).where(eq(repairRequests.id, id)))[0]!;
const events = (id: string) => handle.db.select().from(repairEvents).where(eq(repairEvents.repairId, id)).orderBy(asc(repairEvents.id));

describe("repair approval and Devin submission", () => {
  it("refuses approval when the evidence changed and never submits an unapproved request", async () => {
    const repair = await createRepair();
    expect(await approveRepair(handle.db, repair.id, { operatorId, username: "approver", statement: "x", evidenceSha256: "0".repeat(64) })).toBeNull();
    const devin = fakeDevin({});
    await submitRepair(agentDeps(devin.client), repair.id);
    expect(devin.calls).toHaveLength(0);
    expect((await reload(repair.id)).status).toBe("awaiting_approval");
  });

  it("refuses a second open repair for the same finding", async () => {
    const first = await createRepair();
    await expect(
      handle.db.insert(repairRequests).values({ ...first, id: randomUUID(), devinTag: `faultline-repair-${randomUUID()}`, devinSessionId: null }),
    ).rejects.toThrow();
  });

  it("creates exactly one session after approval, with screenshots, tags, repository, and the stored prompt", async () => {
    const repair = await createRepair();
    expect(await approve(repair.id)).not.toBeNull();
    const devin = fakeDevin({});
    const deps = agentDeps(devin.client);
    await Promise.all([submitRepair(deps, repair.id), submitRepair(deps, repair.id)]);
    await submitRepair(deps, repair.id);

    const creates = devin.calls.filter((c) => c.method === "POST" && c.path.endsWith("/sessions"));
    expect(creates).toHaveLength(1);
    const body = creates[0]!.body as { prompt: string; tags: string[]; repos: string[]; attachment_urls?: string[] };
    expect(body.tags).toEqual(["faultline", repair.devinTag]);
    expect(body.repos).toEqual([`${OWNER}/${NAME}`]);
    expect(body.prompt).toContain(repairMarker(repair.id));
    expect(body.attachment_urls?.length).toBe(2);
    expect(devin.calls.filter((c) => c.path.endsWith("/attachments"))).toHaveLength(2);

    const row = await reload(repair.id);
    expect(row.status).toBe("devin_running");
    expect(row.devinSessionId).toBe(devin.sessionId);
    expect(row.prompt).toBe(body.prompt);
    expect(row.promptSha256).toBe(sha256Hex(body.prompt));
    expect(row.attachments?.every((a) => a.url && !a.error)).toBe(true);
    expect((await events(repair.id)).map((e) => e.kind)).toEqual(expect.arrayContaining(["submission_started", "attachments", "session_created"]));
  });

  it("fails honestly without credentials instead of pretending to submit", async () => {
    const repair = await createRepair();
    await approve(repair.id);
    await submitRepair(agentDeps(null), repair.id);
    const row = await reload(repair.id);
    expect(row.status).toBe("devin_failed");
    expect(row.devinSessionId).toBeNull();
    expect(row.statusDetail).toMatch(/not configured/);
  });

  it("never re-creates a session after an unconfirmed request; a restarted worker recovers it by tag", async () => {
    const repair = await createRepair();
    await approve(repair.id);
    const lost = fakeDevin({ create: "timeout" });
    await submitRepair(agentDeps(lost.client), repair.id);
    expect((await reload(repair.id)).status).toBe("submitting");
    expect(lost.calls.filter((c) => c.method === "POST" && c.path.endsWith("/sessions"))).toHaveLength(1);

    // A new worker process, after the stale window.
    await handle.db.update(repairRequests).set({ submitStartedAt: new Date(Date.now() - 120_000) }).where(eq(repairRequests.id, repair.id));
    const restarted = fakeDevin({ sessions: [lost.session({ tags: ["faultline", repair.devinTag] })] });
    await recoverSubmissions(agentDeps(restarted.client));
    const row = await reload(repair.id);
    expect(row.status).toBe("devin_running");
    expect(row.devinSessionId).toBe(lost.sessionId);
    expect(restarted.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(restarted.calls[0]!.path).toBe("/v3/organizations/org-test/sessions");
  });

  it("gives up after the confirmation window without creating anything", async () => {
    const repair = await createRepair();
    await approve(repair.id);
    await handle.db.update(repairRequests).set({ status: "submitting", submitStartedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(repairRequests.id, repair.id));
    const devin = fakeDevin({ sessions: [] });
    await recoverSubmissions(agentDeps(devin.client));
    expect((await reload(repair.id)).status).toBe("devin_failed");
    expect(devin.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("Devin session sync", () => {
  it("records messages once, rejects pull requests outside the linked repository, and accepts only GitHub-confirmed ones", async () => {
    const repair = await createRepair({ status: "devin_running", devinSessionId: `devin-${randomUUID()}`, devinStatus: "running" });
    const messages = [
      { event_id: "e1", source: "devin", message: "Reading shop.js", created_at: Math.floor(Date.now() / 1000) },
      { event_id: "e2", source: "devin", message: "Opened a pull request. token=hunter2secret", created_at: Math.floor(Date.now() / 1000) },
    ];
    let prs = [{ pr_url: "https://github.com/evil/shop/pull/1", pr_state: "open" }];
    const devin = fakeDevin({ messages, session: () => ({ status: "running", status_detail: "working", pull_requests: prs }) });
    const github = fakeGitHub((n) => pull(repair.id, { number: n }));
    await syncRepair(agentDeps(devin.client, github), await reload(repair.id));
    let row = await reload(repair.id);
    expect(row.status).toBe("devin_running");
    expect(row.prHeadSha).toBeNull();

    prs = [{ pr_url: `https://github.com/${OWNER}/${NAME}/pull/12`, pr_state: "open" }];
    await syncRepair(agentDeps(devin.client, github), row);
    row = await reload(repair.id);
    expect(row.status).toBe("ready_for_verification");
    expect(row.prHeadSha).toBe(HEAD_SHA);
    expect(row.prNumber).toBe(12);

    const all = await events(repair.id);
    expect(all.filter((e) => e.kind === "message")).toHaveLength(2);
    expect(all.find((e) => e.externalId === "msg:e2")!.message).not.toContain("hunter2secret");
    expect(all.some((e) => e.kind === "pr_rejected" && e.message.includes("evil/shop"))).toBe(true);
    expect(all.filter((e) => e.kind === "pr_confirmed")).toHaveLength(1);
  });

  it("does not accept a pull request against another base branch", async () => {
    const repair = await createRepair({ status: "devin_running", devinSessionId: `devin-${randomUUID()}`, devinStatus: "running" });
    const devin = fakeDevin({ session: () => ({ status: "exit", status_detail: "finished", pull_requests: [{ pr_url: `https://github.com/${OWNER}/${NAME}/pull/12`, pr_state: "open" }] }) });
    await syncRepair(agentDeps(devin.client, fakeGitHub((n) => pull(repair.id, { number: n, baseRef: "release" }))), await reload(repair.id));
    const row = await reload(repair.id);
    expect(row.prHeadSha).toBeNull();
    expect(row.status).toBe("devin_finished_no_pr");
  });
});

describe("independent verification", () => {
  const settings: CandidateSettings = { runtime: "podman", image: "unused", network: "unused", basePort: VERIFY_PORT, workRoot: "/nonexistent", maxArchiveBytes: 1, startTimeoutMs: 1 };

  /** Serves a storefront variant on the verification port in place of a container build. */
  function seam(variants: { original: string | null; candidate: string | null }) {
    const started: string[] = [];
    return {
      started,
      startCandidate: async (spec: CandidateSpec): Promise<RunningCandidate> => {
        const server = await startPatchedStorefront(partner.origin, variants[spec.label], VERIFY_PORT);
        started.push(`${spec.label}:${spec.sha}`);
        return {
          label: spec.label,
          sha: spec.sha,
          origin: server.origin,
          extraOrigins: [],
          archiveSha256: "a".repeat(64),
          archiveBytes: 1,
          archiveRoot: `${NAME}-${spec.sha}`,
          containerName: `test-${spec.label}`,
          containerId: "test",
          image: "test",
          imageId: "test",
          identity: [`Test server for ${spec.label} ${spec.sha.slice(0, 12)}.`],
          stop: server.close,
        };
      },
    };
  }

  async function verify(variants: { original: string | null; candidate: string | null }, before?: (repairId: string) => Promise<void>) {
    const repair = await createRepair({ status: "ready_for_verification", devinSessionId: `devin-${randomUUID()}`, prNumber: 12, prHeadSha: HEAD_SHA, prUrl: `https://github.com/${OWNER}/${NAME}/pull/12` });
    await before?.(repair.id);
    const queued = await queueVerification(handle.db, repair.id, operatorId);
    expect(queued.ok).toBe(true);
    const run = await claimNextVerification(handle.db, "test-worker");
    expect(run).not.toBeNull();
    const s = seam(variants);
    const deps: VerificationDeps = {
      db: handle.db,
      storage,
      env,
      github: fakeGitHub((n) => pull(repair.id, { number: n })),
      workerId: "test-worker",
      settings,
      log,
      heartbeatIntervalMs: 500,
      startCandidate: s.startCandidate,
      checkRuntime: async () => ({ ok: true, version: "test" }),
    };
    await runVerification(deps, run!);
    const [saved] = await handle.db.select().from(verificationRuns).where(eq(verificationRuns.id, run!.id));
    const checks = await handle.db.select().from(verificationChecks).where(eq(verificationChecks.runId, run!.id)).orderBy(asc(verificationChecks.ordinal));
    return { repair: await reload(repair.id), run: saved!, checks, started: s.started };
  }

  it("VERIFIED FIXED: unfixed original fails twice, the fixed candidate passes the unchanged test twice and normal behavior holds", async () => {
    const { repair, run, checks, started } = await verify({ original: null, candidate: FIXED_LOAD });
    expect(run.verdict, JSON.stringify(run.rationale)).toBe("verified_fixed");
    expect(repair.status).toBe("verified_fixed");
    expect(repair.verifiedSha).toBe(HEAD_SHA);
    expect(started).toEqual([`original:${BASE_SHA}`, `candidate:${HEAD_SHA}`]);
    expect(checks.map((c) => `${c.stage}:${c.status}`)).toEqual([
      "original-normal:passed",
      "original-fault:failed",
      "original-fault:failed",
      "original-fault-evidence:failed",
      "candidate-fault:passed",
      "candidate-fault:passed",
      "candidate-fault-evidence:passed",
      "candidate-normal:passed",
    ]);
    const evidence = checks.filter((c) => c.stage.endsWith("evidence"));
    for (const c of evidence) {
      expect(c.screenshotKey).toMatch(new RegExp(`^repairs/${repair.id}/verifications/${run.id}/`));
      const bytes = await storage.getBuffer(c.screenshotKey!);
      expect(sha256Hex(bytes)).toBe(c.screenshotSha256);
    }
    expect(checks.filter((c) => c.method === "regression-test").every((c) => c.output)).toBe(true);
  }, 300_000);

  it("STILL FAILING: the candidate does not change the behavior", async () => {
    const { run, checks } = await verify({ original: null, candidate: null });
    expect(run.verdict, JSON.stringify(run.rationale)).toBe("still_failing");
    expect(checks.filter((c) => c.stage === "candidate-fault").map((c) => c.status)).toEqual(["failed", "failed"]);
  }, 300_000);

  it("REGRESSION DETECTED: the candidate survives the fault but breaks normal behavior", async () => {
    const { run, checks } = await verify({ original: null, candidate: REGRESSING_LOAD });
    expect(run.verdict, JSON.stringify(run.rationale)).toBe("regression_detected");
    expect(checks.find((c) => c.stage === "candidate-normal")!.status).toBe("failed");
  }, 300_000);

  it("INCONCLUSIVE: the original no longer reproduces the failure, so the candidate is not judged", async () => {
    const { run, checks, started } = await verify({ original: FIXED_LOAD, candidate: FIXED_LOAD });
    expect(run.verdict, JSON.stringify(run.rationale)).toBe("inconclusive");
    expect(started).toEqual([`original:${BASE_SHA}`]);
    expect(checks.filter((c) => c.revision === "candidate").every((c) => c.status === "skipped")).toBe(true);
  }, 300_000);

  it("BLOCKED: a modified regression test is never run", async () => {
    const [stored] = await handle.db.select().from(regressionTests).where(eq(regressionTests.experimentId, experimentId));
    try {
      const { run, checks, started } = await verify({ original: null, candidate: FIXED_LOAD }, async () => {
        await handle.db.update(regressionTests).set({ content: "// weakened" }).where(eq(regressionTests.id, stored!.id));
      });
      expect(run.verdict).toBe("verification_blocked");
      expect(run.rationale?.join(" ")).toMatch(/does not match/);
      expect(checks).toHaveLength(0);
      expect(started).toHaveLength(0);
    } finally {
      await handle.db.update(regressionTests).set({ content: stored!.content }).where(eq(regressionTests.id, stored!.id));
    }
  }, 60_000);

  it("an interrupted verification is closed as blocked and keeps its recorded checks", async () => {
    const repair = await createRepair({ status: "ready_for_verification", devinSessionId: `devin-${randomUUID()}`, prNumber: 12, prHeadSha: HEAD_SHA });
    await queueVerification(handle.db, repair.id, operatorId);
    const run = await claimNextVerification(handle.db, "crashed-worker");
    await handle.db.insert(verificationChecks).values({ runId: run!.id, ordinal: 1, stage: "original-normal", revision: "original", sha: BASE_SHA, targetOrigin: "http://localhost:4790", method: "journey", purpose: "verdict", faultApplied: false, status: "passed" });
    await handle.db.update(verificationRuns).set({ heartbeatAt: new Date(Date.now() - 5 * 60_000) }).where(eq(verificationRuns.id, run!.id));
    const closed = await failStaleVerifications(handle.db, 90_000);
    expect(closed.map((r) => r.id)).toContain(run!.id);
    const row = await reload(repair.id);
    expect(row.status).toBe("verification_blocked");
    expect(row.verdictRationale?.[0]).toMatch(/stopped reporting/);
    expect(await handle.db.select().from(verificationChecks).where(and(eq(verificationChecks.runId, run!.id)))).toHaveLength(1);
    // Only one active verification per repair.
    const again = await queueVerification(handle.db, repair.id, operatorId);
    expect(again.ok).toBe(true);
    expect((await queueVerification(handle.db, repair.id, operatorId)).ok).toBe(false);
  });
});
