import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  discoverDependencies,
  evaluateExperiment,
  journeyDefinitionSchema,
  parseAllowlist,
  type DependencyMatcher,
  type ExperimentFault,
  type JourneyDefinition,
} from "@faultline/shared";
import type { EgressPolicy } from "@faultline/shared/network";
import type { ExecutionLimits } from "../src/executor";
import { JOURNEY_VIEWPORTS, runJourneyExecution, type JourneyExecutionResult } from "../src/journey-executor";
import { compareScreenshots, visualThreshold } from "../src/visual-diff";
import { startEdgeCaseServer, startStorefront, type RunningServer } from "./fixtures";

const limits: ExecutionLimits = {
  navigationTimeoutMs: 15_000,
  settleTimeoutMs: 2_000,
  scenarioTimeoutMs: 60_000,
  maxRedirects: 5,
  maxRequests: 500,
  maxTransferBytes: 50 * 1024 * 1024,
  maxScreenshotHeight: 6000,
};

let browser: Browser;
let shop: RunningServer;
let partner: RunningServer;
let policy: EgressPolicy;
let journey: JourneyDefinition;
let baseline: JourneyExecutionResult;
let calibration: JourneyExecutionResult;

const run = (fault: ExperimentFault | null, j: JourneyDefinition = journey) =>
  runJourneyExecution({ browser, origin: shop.origin, journey: j, fault, viewport: JOURNEY_VIEWPORTS.desktop, policy, limits });

const endpoint = (path: string): DependencyMatcher => ({ scope: "endpoint", origin: shop.origin, method: "GET", pathPattern: path });

beforeAll(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.FAULTLINE_CHROMIUM_SANDBOX !== "false" });
  ({ shop, partner } = await startStorefront());
  policy = { mode: "local", allowlist: parseAllowlist(`${shop.origin}, ${partner.origin}`), subresourcePolicy: "public" };
  journey = journeyDefinitionSchema.parse({
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
    offlineExpectations: [{ type: "assertVisible", target: { by: "text", text: "You are offline" }, timeoutMs: 1500 }],
  });
  [baseline, calibration] = [await run(null), await run(null)];
});

afterAll(async () => {
  await browser?.close();
  await Promise.all([shop?.close(), partner?.close()]);
});

describe("journey baseline", () => {
  it("executes every step in real Chromium and records timing", () => {
    expect(baseline.engineError).toBeNull();
    expect(baseline.steps.map((s) => s.status)).toEqual(Array(8).fill("passed"));
    expect(baseline.steps.every((s) => s.durationMs !== null && s.startedAt !== null)).toBe(true);
    expect(baseline.observation.journeyMs).toBeGreaterThan(0);
    expect(baseline.outcome).toBe("loaded");
    expect(baseline.screenshot?.width).toBe(1366);
    expect(calibration.steps.every((s) => s.status === "passed")).toBe(true);
  });

  it("records sanitized network traffic and discovers real dependencies", () => {
    const keys = discoverDependencies(baseline.requests, shop.origin).map((d) => d.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        `endpoint GET ${shop.origin}/api/catalog`,
        `endpoint GET ${shop.origin}/api/inventory`,
        `endpoint GET ${shop.origin}/api/shipping-quote`,
        `resource ${shop.origin}/shop/shop.js`,
        `origin ${partner.origin}`,
      ]),
    );
    const quote = baseline.requests.find((r) => r.url.includes("/api/shipping-quote"))!;
    expect(quote).toMatchObject({ method: "GET", resourceType: "fetch", status: 200, outcome: "completed", party: "first-party", stepIndex: 5, injected: null });
    expect(baseline.requests.find((r) => r.isMainDocument)?.url).toBe(`${shop.origin}/shop/`);
  });

  it("blocks mutating requests the journey did not allow, and labels them as safety blocks", () => {
    const beacon = baseline.requests.find((r) => r.url === `${partner.origin}/collect`);
    expect(beacon).toMatchObject({ method: "POST", injected: "mutation-blocked", outcome: "intercepted" });
    expect(baseline.events.some((e) => e.kind === "policy_block" && e.message.includes("Blocked a POST request"))).toBe(true);
    expect(baseline.summary.failedRequests).toBe(0);
  });

  it("has low visual variability between two normal runs", () => {
    const comparison = compareScreenshots(baseline.screenshot!.buffer, calibration.screenshot!.buffer);
    expect(comparison.diffRatio).toBeLessThan(0.01);
    expect(visualThreshold(comparison.diffRatio).ratio).toBeGreaterThanOrEqual(0.01);
  });
});

describe("fault experiments", () => {
  const verdict = (experiment: JourneyExecutionResult, kind: Parameters<typeof evaluateExperiment>[0]["kind"]) =>
    evaluateExperiment({ journey, kind, baseline: baseline.observation, calibration: calibration.observation, experiment: experiment.observation });

  it("API error: injects a labeled 503 and observes the storefront failing to render", async () => {
    const result = await run({ kind: "http-error", matcher: endpoint("/api/inventory"), status: 503 });
    const injected = result.requests.filter((r) => r.injected === "error-response");
    expect(injected).toHaveLength(1);
    expect(injected[0]).toMatchObject({ status: 503, outcome: "intercepted", url: `${shop.origin}/api/inventory` });
    expect(result.events.some((e) => e.kind === "fault_injected" && e.statusCode === 503 && e.message.startsWith("Injected"))).toBe(true);
    // The injected 503 is not counted as a naturally occurring HTTP error.
    expect(result.summary.httpErrors).toBe(0);
    expect(result.events.some((e) => e.kind === "console" && e.severity === "error" && e.message.includes("Storefront failed to load"))).toBe(true);
    expect(result.steps[1]!.status).toBe("failed");
    expect(result.steps.slice(2).every((s) => s.status === "not_reached")).toBe(true);
    expect(result.stepScreenshots.map((s) => s.stepIndex)).toEqual([1]);
    const evaluation = verdict(result, "http-error");
    expect(evaluation.verdict).toBe("broken");
    expect(evaluation.affectedSteps).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("Dependency unavailable: aborts only the partner origin; the journey still completes", async () => {
    const result = await run({ kind: "unavailable", matcher: { scope: "origin", origin: partner.origin }, abortErrorCode: "connectionrefused" });
    const aborted = result.requests.filter((r) => r.injected === "aborted");
    expect(aborted.length).toBeGreaterThan(0);
    expect(aborted.every((r) => r.origin === partner.origin)).toBe(true);
    expect(result.requests.filter((r) => r.origin === shop.origin && r.injected).length).toBe(0);
    expect(verdict(result, "unavailable").verdict).toBe("resilient");
  });

  it("Slow API: holds the shipping quote and measures the step against its budget", async () => {
    const result = await run({ kind: "latency", matcher: endpoint("/api/shipping-quote"), delayMs: 2_600 });
    const held = result.requests.find((r) => r.injected === "delayed")!;
    expect(held.durationMs).toBeGreaterThanOrEqual(2_600);
    expect(held.outcome).toBe("intercepted");
    expect(result.steps[6]!.durationMs).toBeGreaterThan(2_000);
    const evaluation = verdict(result, "latency");
    expect(evaluation.verdict).toBe("degraded");
    expect(evaluation.reasons.some((r) => r.code === "step_budget_exceeded" && r.stepIndex === 6)).toBe(true);
  });

  it("Online → offline: loads online, then observes the journey and the offline expectation", async () => {
    const result = await run({ kind: "offline" });
    expect(result.events.some((e) => e.kind === "fault_injected" && e.message.includes("offline"))).toBe(true);
    expect(result.steps[1]!.status).toBe("passed");
    expect(result.offlineChecks).toHaveLength(1);
    expect(result.offlineChecks[0]!.status).toBe("failed");
    expect(verdict(result, "offline").verdict).toBe("degraded");
  });

  it("Narrow viewport: measures horizontal overflow and control placement", async () => {
    const result = await run({ kind: "narrow-viewport", width: 360, height: 740 });
    expect(result.viewport).toEqual({ width: 360, height: 740, isMobile: true });
    expect(result.observation.layout).not.toBeNull();
    expect(result.events.some((e) => e.message.startsWith("Layout check"))).toBe(true);
    expect(["resilient", "degraded"]).toContain(verdict(result, "narrow-viewport").verdict);
  });

  it("refuses to fill password fields but fills ordinary inputs", async () => {
    const edge = await startEdgeCaseServer(() => 1);
    try {
      const j = journeyDefinitionSchema.parse({
        name: "sign in",
        steps: [
          { type: "navigate", path: "/password-form" },
          { type: "fill", target: { by: "label", label: "Email" }, value: "someone@example.com" },
          { type: "fill", target: { by: "label", label: "Password" }, value: "hunter2" },
        ],
      });
      const result = await runJourneyExecution({
        browser,
        origin: edge.origin,
        journey: j,
        fault: null,
        viewport: JOURNEY_VIEWPORTS.desktop,
        policy: { ...policy, allowlist: parseAllowlist(edge.origin) },
        limits,
      });
      expect(result.steps[1]!.status).toBe("passed");
      expect(result.steps[2]!.status).toBe("failed");
      expect(result.steps[2]!.error).toMatch(/does not fill password/);
    } finally {
      await edge.close();
    }
  });
});
