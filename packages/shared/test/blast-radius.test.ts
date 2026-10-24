import { describe, expect, it } from "vitest";
import {
  blastRadiusConfigSchema,
  combineAttempts,
  evaluateExperiment,
  planExperiments,
  type JourneyObservation,
  type StepObservation,
} from "../src/blast-radius";
import { classifyRequest, discoverDependencies, matchesDependency, normalizePath, type ObservedRequest } from "../src/dependencies";
import { isMutationAllowed, journeyDefinitionSchema, resolveJourneyUrl, type JourneyDefinition } from "../src/journey";
import { generateRegressionTest } from "../src/regression-test";
import { scenarioConfigSchema } from "../src/scenarios";

const ORIGIN = "http://localhost:4600";

const journey: JourneyDefinition = journeyDefinitionSchema.parse({
  name: "Buy a backpack",
  steps: [
    { type: "navigate", path: "/shop/" },
    { type: "assertVisible", target: { by: "text", text: "Trail Backpack" } },
    { type: "click", target: { by: "role", role: "button", name: "Add Trail Backpack to cart" } },
    { type: "assertText", target: { by: "testId", testId: "cart-count" }, text: "1 item", maxDurationMs: 1500 },
  ],
  performance: { maxJourneyMs: 8000 },
});

function obs(statuses: Array<StepObservation["status"]>, overrides: Partial<JourneyObservation> = {}, durations: number[] = []): JourneyObservation {
  return {
    completed: true,
    engineError: null,
    steps: statuses.map((status, index) => ({ index, status, durationMs: status === "not_reached" ? null : (durations[index] ?? 100), error: status === "failed" ? "Timeout 5000ms exceeded" : null })),
    journeyMs: statuses.every((s) => s === "passed") ? 2000 : null,
    captureComplete: true,
    faultApplications: 1,
    layout: null,
    offlineChecks: [],
    ...overrides,
  };
}

const allPass = () => obs(["passed", "passed", "passed", "passed"]);

describe("journey definitions", () => {
  it("requires the first step to navigate and caps step count", () => {
    expect(journeyDefinitionSchema.safeParse({ name: "x", steps: [{ type: "reload" }] }).success).toBe(false);
    const many = Array.from({ length: 31 }, () => ({ type: "reload" }));
    expect(journeyDefinitionSchema.safeParse({ name: "x", steps: [{ type: "navigate", path: "/" }, ...many] }).success).toBe(false);
  });

  it("refuses absolute and protocol-relative paths", () => {
    for (const path of ["https://evil.example/", "//evil.example/", "javascript:alert(1)", "\\\\evil", "shop"]) {
      expect(journeyDefinitionSchema.safeParse({ name: "x", steps: [{ type: "navigate", path }] }).success, path).toBe(false);
    }
    expect(resolveJourneyUrl(ORIGIN, "/shop/?q=1#frag")).toBe("http://localhost:4600/shop/?q=1");
  });

  it("only accepts plain CSS selectors", () => {
    const step = (selector: string) => ({ name: "x", steps: [{ type: "navigate", path: "/" }, { type: "click", target: { by: "css", selector } }] });
    expect(journeyDefinitionSchema.safeParse(step("button.primary")).success).toBe(true);
    expect(journeyDefinitionSchema.safeParse(step("xpath=//button")).success).toBe(false);
    expect(journeyDefinitionSchema.safeParse(step("div >> text=Buy")).success).toBe(false);
  });

  it("rejects unknown step types such as script evaluation", () => {
    expect(journeyDefinitionSchema.safeParse({ name: "x", steps: [{ type: "navigate", path: "/" }, { type: "evaluate", script: "alert(1)" }] }).success).toBe(false);
  });

  it("blocks mutating requests unless explicitly allowed on the project origin", () => {
    const j = journeyDefinitionSchema.parse({ name: "x", steps: [{ type: "navigate", path: "/" }], allowedMutations: [{ method: "POST", path: "/api/cart" }] });
    expect(isMutationAllowed(j, ORIGIN, "GET", `${ORIGIN}/api/anything`)).toBe(true);
    expect(isMutationAllowed(j, ORIGIN, "POST", `${ORIGIN}/api/cart`)).toBe(true);
    expect(isMutationAllowed(j, ORIGIN, "POST", `${ORIGIN}/api/orders`)).toBe(false);
    expect(isMutationAllowed(j, ORIGIN, "DELETE", `${ORIGIN}/api/cart`)).toBe(false);
    expect(isMutationAllowed(j, ORIGIN, "POST", "http://other.example/api/cart")).toBe(false);
  });
});

describe("dependency discovery", () => {
  const req = (url: string, overrides: Partial<ObservedRequest> = {}): ObservedRequest => ({
    url,
    method: "GET",
    resourceType: "fetch",
    status: 200,
    durationMs: 20,
    outcome: "completed",
    isMainDocument: false,
    ...overrides,
  });

  it("normalizes identifier-like path segments", () => {
    expect(normalizePath("/api/orders/123/items/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f")).toBe("/api/orders/:n/items/:uuid");
    expect(normalizePath("/static/app.3f2a9c.js")).toBe("/static/app.3f2a9c.js");
    expect(normalizePath("/blob/0123456789abcdef0123")).toBe("/blob/:hex");
  });

  it("groups first-party API calls by method and path, third parties by origin, and skips the main document", () => {
    const deps = discoverDependencies(
      [
        req(`${ORIGIN}/shop/`, { resourceType: "document", isMainDocument: true }),
        req(`${ORIGIN}/api/inventory?sku=1`),
        req(`${ORIGIN}/api/inventory?sku=2`, { status: 503, outcome: "completed" }),
        req(`${ORIGIN}/api/orders/7`, { method: "POST" }),
        req(`${ORIGIN}/shop/shop.css`, { resourceType: "stylesheet" }),
        req("http://localhost:4601/widget/reviews.js", { resourceType: "script" }),
        req("http://localhost:4601/api/reviews?token=abc", { resourceType: "fetch" }),
      ],
      ORIGIN,
    );
    expect(deps.map((d) => d.key)).toEqual([
      "endpoint GET http://localhost:4600/api/inventory",
      "endpoint POST http://localhost:4600/api/orders/:n",
      "resource http://localhost:4600/shop/shop.css",
      "origin http://localhost:4601",
    ]);
    const inventory = deps[0]!;
    expect(inventory.requestCount).toBe(2);
    expect(inventory.statuses).toEqual([200, 503]);
    expect(inventory.sampleUrls).toHaveLength(2);
    expect(deps[1]!.eligibleFaults).toEqual(["unavailable"]);
    expect(deps[3]!.sampleUrls.some((u) => u.includes("token=%5Bredacted%5D"))).toBe(true);
  });

  it("matches requests exactly on origin, method, and normalized path", () => {
    const base = classifyRequest({ url: `${ORIGIN}/api/orders/7`, method: "GET", resourceType: "fetch", isMainDocument: false }, ORIGIN)!;
    expect(matchesDependency(base.matcher, { url: `${ORIGIN}/api/orders/8?x=1`, method: "GET" })).toBe(true);
    expect(matchesDependency(base.matcher, { url: `${ORIGIN}/api/orders/8`, method: "POST" })).toBe(false);
    expect(matchesDependency(base.matcher, { url: `${ORIGIN}/api/orders`, method: "GET" })).toBe(false);
    expect(matchesDependency(base.matcher, { url: `http://localhost:4601/api/orders/8`, method: "GET" })).toBe(false);
  });
});

describe("experiment planning", () => {
  const deps = discoverDependencies(
    [
      { url: `${ORIGIN}/api/catalog`, method: "GET", resourceType: "fetch", status: 200, durationMs: 5, outcome: "completed", isMainDocument: false },
      { url: `${ORIGIN}/api/inventory`, method: "GET", resourceType: "fetch", status: 200, durationMs: 5, outcome: "completed", isMainDocument: false },
      { url: "http://localhost:4601/widget.js", method: "GET", resourceType: "script", status: 200, durationMs: 5, outcome: "completed", isMainDocument: false },
    ],
    ORIGIN,
  );
  const config = (input: Record<string, unknown>) => blastRadiusConfigSchema.parse({ kind: "blast-radius", journeyId: "9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f", ...input });

  it("gives every dependency its first fault before any gets a second, and reports what was skipped", () => {
    const { planned, skipped } = planExperiments(deps, config({ maxExperiments: 3 }));
    expect(planned.map((p) => `${p.kind} ${p.dependencyKey}`)).toEqual([
      "http-error endpoint GET http://localhost:4600/api/catalog",
      "http-error endpoint GET http://localhost:4600/api/inventory",
      "unavailable origin http://localhost:4601",
    ]);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.filter((s) => s.reason.includes("limit")).map((s) => `${s.fault} ${s.dependencyKey}`)).toContain("unavailable endpoint GET http://localhost:4600/api/catalog");
    expect(skipped.find((s) => s.fault === "http-error" && s.dependencyKey.startsWith("origin"))?.reason).toMatch(/only to first-party API endpoints/);
  });

  it("adds offline and narrow viewport without counting them against the limit", () => {
    const { planned } = planExperiments(deps, config({ maxExperiments: 1, includeOffline: true, includeNarrowViewport: true }));
    expect(planned.map((p) => p.kind)).toEqual(["http-error", "offline", "narrow-viewport"]);
  });

  it("honors explicit targets and refuses ones not observed in this baseline", () => {
    const { planned, skipped } = planExperiments(
      deps,
      config({ targets: [{ dependencyKey: "endpoint GET http://localhost:4600/api/inventory", fault: "latency" }, { dependencyKey: "endpoint GET http://localhost:4600/api/gone", fault: "unavailable" }] }),
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.fault).toMatchObject({ kind: "latency", delayMs: 3000 });
    expect(skipped[0]!.reason).toMatch(/Not observed/);
  });

  it("is accepted as a scenario and requires something to test", () => {
    expect(scenarioConfigSchema.safeParse({ kind: "blast-radius", journeyId: "9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f" }).success).toBe(true);
    expect(scenarioConfigSchema.safeParse({ kind: "blast-radius", journeyId: "9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f", faults: [] }).success).toBe(false);
  });
});

describe("verdicts", () => {
  const evaluate = (experiment: JourneyObservation, kind: Parameters<typeof evaluateExperiment>[0]["kind"] = "http-error", j = journey, baseline = allPass(), calibration = allPass()) =>
    evaluateExperiment({ journey: j, kind, baseline, calibration, experiment });

  it("BROKEN when a stable assertion fails, listing unreached steps", () => {
    const result = evaluate(obs(["passed", "failed", "not_reached", "not_reached"]));
    expect(result.verdict).toBe("broken");
    expect(result.affectedSteps).toEqual([1, 2, 3]);
    expect(result.reasons[0]!.message).toMatch(/passed in both baseline runs but failed/);
  });

  it("RESILIENT only when every usable check passes", () => {
    expect(evaluate(allPass()).verdict).toBe("resilient");
  });

  it("DEGRADED when a duration budget met in both baselines is exceeded", () => {
    const result = evaluate(obs(["passed", "passed", "passed", "passed"], {}, [100, 100, 100, 3200]));
    expect(result.verdict).toBe("degraded");
    expect(result.reasons.map((r) => r.code)).toContain("step_budget_exceeded");
  });

  it("does not use a budget the baseline itself missed", () => {
    const slowBaseline = obs(["passed", "passed", "passed", "passed"], {}, [100, 100, 100, 2000]);
    const result = evaluate(obs(["passed", "passed", "passed", "passed"], {}, [100, 100, 100, 3200]), "latency", journey, slowBaseline);
    expect(result.verdict).toBe("resilient");
    expect(result.excludedSteps.some((s) => s.index === 3)).toBe(true);
  });

  it("INCONCLUSIVE without assertions, with an unstable baseline, or when the fault never applied", () => {
    const noAsserts = journeyDefinitionSchema.parse({ name: "nav", steps: [{ type: "navigate", path: "/" }] });
    expect(evaluate(obs(["passed"]), "http-error", noAsserts, obs(["passed"]), obs(["passed"])).verdict).toBe("inconclusive");

    const flaky = obs(["passed", "failed", "not_reached", "not_reached"]);
    const unstable = evaluate(obs(["passed", "failed", "not_reached", "not_reached"]), "http-error", journey, allPass(), flaky);
    expect(unstable.verdict).toBe("inconclusive");
    expect(unstable.excludedSteps.find((s) => s.index === 1)?.reason).toMatch(/Unstable/);

    const notApplied = evaluate(obs(["passed", "failed", "not_reached", "not_reached"], { faultApplications: 0 }));
    expect(notApplied.verdict).toBe("inconclusive");
    expect(notApplied.reasons[0]!.code).toBe("fault_not_applied");
  });

  it("TEST FAILED when the experiment itself did not execute", () => {
    const result = evaluate(obs([], { completed: false, engineError: "Browser closed" }));
    expect(result.verdict).toBe("test_failed");
  });

  it("withholds a passing verdict when capture was incomplete", () => {
    expect(evaluate(obs(["passed", "passed", "passed", "passed"], { captureComplete: false })).verdict).toBe("inconclusive");
  });

  it("treats offline outcomes as observations unless an offline expectation exists", () => {
    const offlineRun = obs(["passed", "failed", "not_reached", "not_reached"], { faultApplications: 0 });
    expect(evaluate(offlineRun, "offline").verdict).toBe("inconclusive");
    const withExpectation = journeyDefinitionSchema.parse({ ...journey, offlineExpectations: [{ type: "assertVisible", target: { by: "text", text: "You are offline" } }] });
    expect(evaluate({ ...offlineRun, offlineChecks: [{ index: 0, status: "failed", durationMs: 5000, error: "not visible" }] }, "offline", withExpectation).verdict).toBe("degraded");
    expect(evaluate({ ...offlineRun, offlineChecks: [{ index: 0, status: "passed", durationMs: 10, error: null }] }, "offline", withExpectation).verdict).toBe("resilient");
  });

  it("DEGRADED for horizontal overflow at a narrow viewport", () => {
    const result = evaluate(obs(["passed", "passed", "passed", "passed"], { layout: { horizontalOverflowPx: 240, offscreenSteps: [2] }, faultApplications: 0 }), "narrow-viewport");
    expect(result.verdict).toBe("degraded");
    expect(result.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["horizontal_overflow", "control_offscreen"]));
  });

  it("downgrades to INCONCLUSIVE when a confirmation run disagrees", () => {
    const first = evaluate(obs(["passed", "failed", "not_reached", "not_reached"]));
    expect(combineAttempts(first, evaluate(obs(["passed", "failed", "not_reached", "not_reached"]))).reproducibility).toBe("reproduced");
    const disagreed = combineAttempts(first, evaluate(allPass()));
    expect(disagreed.verdict).toBe("inconclusive");
    expect(disagreed.reproducibility).toBe("not-reproduced");
  });
});

describe("regression test generation", () => {
  const base = {
    journey,
    journeyRef: { id: "j", version: 2 },
    analyzedOrigin: ORIGIN,
    viewport: { width: 1366, height: 900, isMobile: false },
    stableSteps: [0, 1, 2, 3],
    includeBudgets: false,
  };

  it("recreates an injected error for a first-party endpoint relative to the supplied target", () => {
    const test = generateRegressionTest({
      ...base,
      experiment: {
        id: "0d9c1c4e-0000-4000-8000-000000000000",
        scanId: "s",
        verdict: "broken",
        fault: { kind: "http-error", matcher: { scope: "endpoint", origin: ORIGIN, method: "GET", pathPattern: "/api/inventory" }, status: 503 },
        dependencyLabel: "GET /api/inventory",
        observedAt: "2026-10-24T10:00:00.000Z",
        reasons: ["Step 2 failed */ injected"],
      },
    });
    expect(test.filename).toMatch(/^faultline-get-api-inventory-http-error-0d9c1c4e\.spec\.ts$/);
    expect(test.content).toContain("const DEPENDENCY_ORIGIN = ORIGIN;");
    expect(test.content).toContain('const DEPENDENCY_METHOD = "GET";');
    expect(test.content).toContain("status: 503,");
    expect(test.content).toContain("process.env.FAULTLINE_TARGET_URL");
    expect(test.content).toContain('await expect(page.getByTestId("cart-count").first()).toContainText("1 item", { timeout: 5000 });');
    expect(test.content).toContain("expect(faultApplications");
    expect(test.content).not.toContain("Step 2 failed */");
    expect(test.command).toBe(`FAULTLINE_TARGET_URL=${ORIGIN} npx playwright test ${test.filename}`);
  });

  it("asserts a control is disabled", () => {
    const withDisabled = journeyDefinitionSchema.parse({
      ...journey,
      steps: [...journey.steps, { type: "assertDisabled", target: { by: "role", role: "button", name: "Add Camp Bottle to cart" } }],
    });
    const test = generateRegressionTest({
      ...base,
      journey: withDisabled,
      stableSteps: [0, 1, 2, 3, 4],
      experiment: {
        id: "0d9c1c4e-0000-4000-8000-000000000000",
        scanId: "s",
        verdict: "broken",
        fault: { kind: "http-error", matcher: { scope: "endpoint", origin: ORIGIN, method: "GET", pathPattern: "/api/inventory" }, status: 503 },
        dependencyLabel: "GET /api/inventory",
        observedAt: "2026-10-24T10:00:00.000Z",
        reasons: [],
      },
    });
    expect(test.content).toContain('await expect(page.getByRole("button", { name: "Add Camp Bottle to cart", exact: false }).first()).toBeDisabled({ timeout: 5000 });');
  });

  it("asserts violated budgets and layout for DEGRADED findings and keeps third-party origins literal", () => {
    const test = generateRegressionTest({
      ...base,
      includeBudgets: true,
      viewport: { width: 360, height: 740, isMobile: true },
      experiment: {
        id: "1d9c1c4e-0000-4000-8000-000000000000",
        scanId: "s",
        verdict: "degraded",
        fault: { kind: "latency", matcher: { scope: "origin", origin: "http://localhost:4601" }, delayMs: 3000 },
        dependencyLabel: "localhost:4601",
        observedAt: "2026-10-24T10:00:00.000Z",
        reasons: [],
      },
    });
    expect(test.content).toContain('const DEPENDENCY_ORIGIN = "http://localhost:4601";');
    expect(test.content).toContain("setTimeout(resolve, 3000)");
    expect(test.content).toContain('await timed("Step 4: test id \\"cart-count\\" contains \\"1 item\\"", 1500');
    expect(test.content).toContain("budget 8000 ms");
    expect(test.content).toContain("isMobile: true");
  });

  it("skips unstable steps rather than asserting behavior the baseline never showed", () => {
    const test = generateRegressionTest({
      ...base,
      stableSteps: [0, 1, 2],
      experiment: {
        id: "2d9c1c4e-0000-4000-8000-000000000000",
        scanId: "s",
        verdict: "broken",
        fault: { kind: "unavailable", matcher: { scope: "origin", origin: "http://localhost:4601" }, abortErrorCode: "connectionrefused" },
        dependencyLabel: null,
        observedAt: "x",
        reasons: [],
      },
    });
    expect(test.content).not.toContain("cart-count");
    expect(test.content).toContain('route.abort("connectionrefused")');
  });
});
