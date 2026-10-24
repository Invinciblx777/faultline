import { describeFault, VERDICT_LABELS, type ExperimentFault, type Verdict } from "./blast-radius";
import { describeStep, isAssertionStep, type JourneyDefinition, type JourneyLocator, type JourneyStep } from "./journey";

/**
 * Generates an executable Playwright Test file for one finding.
 *
 * The test replays the journey steps that passed in both baseline runs,
 * recreates the exact fault, and asserts the behavior those runs established.
 * On the unfixed application it fails at the step the experiment observed
 * failing; once the application tolerates the fault it passes.
 */

export const REGRESSION_TEST_SCHEMA = "faultline.regression-test/v1";

export interface RegressionTestInput {
  journey: JourneyDefinition;
  journeyRef: { id: string; version: number };
  experiment: {
    id: string;
    scanId: string;
    verdict: Verdict;
    fault: ExperimentFault;
    dependencyLabel: string | null;
    observedAt: string;
    reasons: string[];
  };
  /** Origin the analysis ran against. Used for documentation and to tell first-party dependencies apart. */
  analyzedOrigin: string;
  viewport: { width: number; height: number; isMobile: boolean };
  /** Journey steps that passed in both baseline runs. Only these are replayed and asserted. */
  stableSteps: number[];
  /** Include duration and layout expectations (DEGRADED findings). */
  includeBudgets: boolean;
}

export interface GeneratedRegressionTest {
  filename: string;
  content: string;
  command: string;
}

const str = (value: string) => JSON.stringify(value);

/** Text placed inside a block comment: no comment terminators, no line breaks. */
function commentText(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/[\r\n]+/g, " ");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "journey"
  );
}

export function locatorCode(locator: JourneyLocator, page = "page"): string {
  switch (locator.by) {
    case "role":
      return `${page}.getByRole(${str(locator.role)}, { name: ${str(locator.name)}, exact: ${locator.exact} }).first()`;
    case "text":
      return `${page}.getByText(${str(locator.text)}, { exact: ${locator.exact} }).first()`;
    case "label":
      return `${page}.getByLabel(${str(locator.label)}, { exact: ${locator.exact} }).first()`;
    case "placeholder":
      return `${page}.getByPlaceholder(${str(locator.placeholder)}, { exact: ${locator.exact} }).first()`;
    case "testId":
      return `${page}.getByTestId(${str(locator.testId)}).first()`;
    case "css":
      return `${page}.locator(${str(`css=${locator.selector}`)}).first()`;
  }
}

function stepBody(step: JourneyStep, checkViewport: boolean): string[] {
  switch (step.type) {
    case "navigate":
      return [`await page.goto(new URL(${str(step.path)}, ORIGIN).toString(), { waitUntil: "load", timeout: ${step.timeoutMs} });`];
    case "reload":
      return [`await page.reload({ waitUntil: "load", timeout: ${step.timeoutMs} });`];
    case "click":
      return [
        ...(checkViewport ? [`await expectWithinViewport(${locatorCode(step.target)});`] : []),
        `await ${locatorCode(step.target)}.click({ timeout: ${step.timeoutMs} });`,
      ];
    case "fill":
      return [
        ...(checkViewport ? [`await expectWithinViewport(${locatorCode(step.target)});`] : []),
        `await ${locatorCode(step.target)}.fill(${str(step.value)}, { timeout: ${step.timeoutMs} });`,
      ];
    case "waitForVisible":
      return [`await ${locatorCode(step.target)}.waitFor({ state: "visible", timeout: ${step.timeoutMs} });`];
    case "assertVisible":
      return [`await expect(${locatorCode(step.target)}).toBeVisible({ timeout: ${step.timeoutMs} });`];
    case "assertHidden":
      return [`await expect(${locatorCode(step.target)}).toBeHidden({ timeout: ${step.timeoutMs} });`];
    case "assertEnabled":
      return [`await expect(${locatorCode(step.target)}).toBeEnabled({ timeout: ${step.timeoutMs} });`];
    case "assertDisabled":
      return [`await expect(${locatorCode(step.target)}).toBeDisabled({ timeout: ${step.timeoutMs} });`];
    case "assertText":
      return [
        step.match === "equals"
          ? `await expect(${locatorCode(step.target)}).toHaveText(${str(step.text)}, { timeout: ${step.timeoutMs} });`
          : `await expect(${locatorCode(step.target)}).toContainText(${str(step.text)}, { timeout: ${step.timeoutMs} });`,
      ];
  }
}

function matcherCode(fault: Extract<ExperimentFault, { matcher: unknown }>, analyzedOrigin: string): string[] {
  const m = fault.matcher;
  const firstParty = m.origin === new URL(analyzedOrigin).origin;
  const originExpr = firstParty ? "ORIGIN" : str(m.origin);
  const lines = [
    `// ${firstParty ? "First-party dependency: matched on the origin under test." : "Third-party dependency: matched on its own origin."}`,
    `const DEPENDENCY_ORIGIN = ${originExpr};`,
  ];
  if (m.scope === "origin") {
    lines.push(`const isTargetDependency = (url: URL, _method: string) => url.origin === DEPENDENCY_ORIGIN;`);
  } else {
    lines.push(`const DEPENDENCY_PATH = ${str(m.pathPattern ?? "/")};`);
    if (m.scope === "endpoint" && m.method) lines.push(`const DEPENDENCY_METHOD = ${str(m.method)};`);
    lines.push(
      `const isTargetDependency = (url: URL, method: string) =>`,
      `  url.origin === DEPENDENCY_ORIGIN && normalizePath(url.pathname) === DEPENDENCY_PATH${m.scope === "endpoint" && m.method ? " && method === DEPENDENCY_METHOD" : ""};`,
    );
  }
  return lines;
}

const NORMALIZE_PATH = [
  "/** Same path normalization FAULTLINE used to group requests into this dependency. */",
  "function normalizePath(pathname: string): string {",
  "  return (",
  "    pathname",
  '      .split("/")',
  "      .map((segment) => {",
  "        if (!segment) return segment;",
  '        if (/^\\d+$/.test(segment)) return ":n";',
  '        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";',
  '        if (/^[0-9a-f]{16,}$/i.test(segment)) return ":hex";',
  '        if (segment.length >= 24 && /\\d/.test(segment) && /[a-z]/i.test(segment) && !segment.includes(".")) return ":token";',
  "        return segment;",
  "      })",
  '      .join("/") || "/"',
  "  );",
  "}",
];

function indent(lines: string[], spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line ? pad + line : line));
}

export function generateRegressionTest(input: RegressionTestInput): GeneratedRegressionTest {
  const { journey, experiment, viewport } = input;
  const fault = experiment.fault;
  const narrow = fault.kind === "narrow-viewport";
  const offline = fault.kind === "offline";
  const networkFault = "matcher" in fault ? fault : null;
  const steps = input.stableSteps.filter((i) => i >= 0 && i < journey.steps.length).sort((a, b) => a - b);
  const filename = `faultline-${slug(experiment.dependencyLabel ?? fault.kind)}-${fault.kind}-${experiment.id.slice(0, 8)}.spec.ts`;
  const command = `FAULTLINE_TARGET_URL=${new URL(input.analyzedOrigin).origin} npx playwright test ${filename}`;
  const mutations = journey.allowedMutations.map((m) => `${m.method} ${m.path}`);
  const faultDescription = describeFault(fault, experiment.dependencyLabel);
  const budgets = input.includeBudgets;

  const header = [
    "/**",
    ` * FAULTLINE regression test (${REGRESSION_TEST_SCHEMA})`,
    " *",
    ` * Finding:     ${VERDICT_LABELS[experiment.verdict]} for journey "${commentText(journey.name)}" (version ${input.journeyRef.version})`,
    ` * Condition:   ${commentText(faultDescription)}`,
    ` * Observed:    ${commentText(experiment.observedAt)} against ${commentText(input.analyzedOrigin)}`,
    ` * Evidence:    analysis ${experiment.scanId}, experiment ${experiment.id}`,
    " *",
    " * What FAULTLINE observed:",
    ...experiment.reasons.slice(0, 8).map((r) => ` *   - ${commentText(r)}`),
    " *",
    " * Expected behavior asserted here: the journey steps below passed in both normal",
    " * baseline runs and must keep passing while the condition above is applied.",
    ...(budgets ? [" * Duration, layout, or recovery expectations that were violated are asserted too."] : []),
    " * The test fails on the application as observed and passes once it tolerates the fault.",
    " *",
    " * Run against an origin you are authorized to test:",
    ` *   ${commentText(command)}`,
    " * Requires @playwright/test and a Chromium install (npx playwright install chromium).",
    " * Contains no credentials, cookies, or response bodies captured from the target.",
    " */",
  ];

  const body: string[] = [];
  body.push(
    `import { expect, test${narrow ? ", type Locator" : ""} } from "@playwright/test";`,
    "",
    "const TARGET = process.env.FAULTLINE_TARGET_URL;",
    "if (!TARGET) {",
    '  throw new Error("Set FAULTLINE_TARGET_URL to the origin you are authorized to test, for example http://localhost:4600");',
    "}",
    "const ORIGIN = new URL(TARGET).origin;",
    "",
    "test.use({",
    `  viewport: { width: ${viewport.width}, height: ${viewport.height} },`,
    ...(viewport.isMobile ? ["  isMobile: true,", "  hasTouch: true,"] : []),
    `  // ${offline ? "Service workers are allowed so the application's own offline support can act." : "Service workers are blocked so every request passes through the route handler below."}`,
    `  serviceWorkers: ${offline ? '"allow"' : '"block"'},`,
    '  reducedMotion: "reduce",',
    '  locale: "en-US",',
    '  timezoneId: "UTC",',
    "});",
    "",
    "/** FAULTLINE blocks requests that could change data unless the journey explicitly allows them. */",
    'const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);',
    `const ALLOWED_MUTATIONS = new Set<string>(${JSON.stringify(mutations)});`,
    "",
  );
  if (networkFault) {
    body.push(...NORMALIZE_PATH, "");
  }
  if (budgets) {
    body.push(
      "/** Runs one journey step and, when a duration budget applies, asserts it. */",
      "async function timed(label: string, budgetMs: number | null, action: () => Promise<void>) {",
      "  const started = Date.now();",
      "  await test.step(label, action);",
      "  const elapsed = Date.now() - started;",
      "  if (budgetMs !== null) {",
      "    expect(elapsed, `${label} took ${elapsed} ms; budget ${budgetMs} ms`).toBeLessThanOrEqual(budgetMs);",
      "  }",
      "}",
      "",
    );
  }
  if (narrow) {
    body.push(
      "/** The control must sit inside the viewport horizontally. */",
      "async function expectWithinViewport(locator: Locator) {",
      "  await locator.waitFor({ state: \"visible\" });",
      "  const box = await locator.boundingBox();",
      "  const width = locator.page().viewportSize()?.width ?? 0;",
      '  expect(box, "control has a layout box").not.toBeNull();',
      '  expect(box!.x, "control starts inside the viewport").toBeGreaterThanOrEqual(-1);',
      '  expect(box!.x + box!.width, "control ends inside the viewport").toBeLessThanOrEqual(width + 1);',
      "}",
      "",
    );
  }

  const title = `${journey.name} keeps working: ${faultDescription}`;
  body.push(`test(${str(title)}, async ({ page, context }) => {`);
  const inner: string[] = [];
  inner.push(`test.setTimeout(${Math.min(300_000, 30_000 + journey.steps.reduce((sum, s) => sum + s.timeoutMs, 0) + (fault.kind === "latency" ? fault.delayMs * 10 : 0))});`);
  inner.push("let faultApplications = 0;", "");
  if (networkFault) inner.push(...matcherCode(networkFault, input.analyzedOrigin), "");
  inner.push(
    'await context.route("**/*", async (route) => {',
    "  const request = route.request();",
    "  const url = new URL(request.url());",
    "  const method = request.method().toUpperCase();",
    "  if (MUTATING_METHODS.has(method) && !(url.origin === ORIGIN && ALLOWED_MUTATIONS.has(`${method} ${url.pathname}`))) {",
    '    return route.abort("blockedbyclient");',
    "  }",
  );
  if (networkFault) {
    inner.push(
      "  const isMainDocument = request.isNavigationRequest() && request.frame().parentFrame() === null;",
      "  if (isMainDocument || !isTargetDependency(url, method)) return route.fallback();",
      "  faultApplications += 1;",
    );
    if (networkFault.kind === "unavailable") {
      inner.push('  return route.abort("connectionrefused");');
    } else if (networkFault.kind === "http-error") {
      inner.push(
        "  const pageOrigin = page.url().startsWith(\"http\") ? new URL(page.url()).origin : ORIGIN;",
        "  return route.fulfill({",
        `    status: ${networkFault.status},`,
        '    contentType: "application/json",',
        "    headers: {",
        '      "cache-control": "no-store",',
        '      "x-faultline-injected": "true",',
        '      ...(url.origin !== pageOrigin ? { "access-control-allow-origin": pageOrigin } : {}),',
        "    },",
        `    body: JSON.stringify({ error: "Injected HTTP ${networkFault.status} (FAULTLINE regression test)" }),`,
        "  });",
      );
    } else {
      inner.push(
        `  await new Promise((resolve) => setTimeout(resolve, ${networkFault.delayMs}));`,
        "  // The page may have cancelled the request while it was held.",
        "  return route.continue().catch(() => undefined);",
      );
    }
  } else {
    inner.push("  return route.fallback();");
  }
  inner.push("});", "");

  const journeyStarted = budgets && journey.performance.maxJourneyMs !== undefined;
  if (journeyStarted) inner.push("const journeyStarted = Date.now();");
  let wentOffline = false;
  for (const i of steps) {
    const step = journey.steps[i]!;
    const label = `Step ${i + 1}: ${describeStep(step)}`;
    const budget = budgets && "maxDurationMs" in step && step.maxDurationMs !== undefined ? step.maxDurationMs : null;
    const lines = stepBody(step, narrow);
    if (budgets) {
      inner.push(`await timed(${str(label)}, ${budget ?? "null"}, async () => {`, ...indent(lines, 2), "});");
    } else {
      inner.push(`// ${commentText(label)}${isAssertionStep(step) ? " (assertion)" : ""}`, ...lines);
    }
    if (offline && !wentOffline && step.type === "navigate") {
      wentOffline = true;
      inner.push("", "// The application loaded online; now the browser context goes offline.", "await context.setOffline(true);", "");
    }
  }
  if (journeyStarted) {
    inner.push(
      "",
      "const journeyMs = Date.now() - journeyStarted;",
      `expect(journeyMs, \`journey took \${journeyMs} ms; budget ${journey.performance.maxJourneyMs} ms\`).toBeLessThanOrEqual(${journey.performance.maxJourneyMs});`,
    );
  }
  if (offline && journey.offlineExpectations.length > 0) {
    inner.push("", "// Offline recovery expectations configured on the journey.");
    for (const expectation of journey.offlineExpectations) inner.push(...stepBody(expectation, false));
  }
  if (narrow) {
    inner.push(
      "",
      "// The page must not scroll horizontally at this width.",
      "const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);",
      'expect(overflow, "horizontal overflow in CSS pixels").toBeLessThanOrEqual(0);',
    );
  }
  if (networkFault) {
    inner.push("", "// Guard against a vacuous pass: the fault must actually have been applied.", 'expect(faultApplications, "requests the injected fault acted on").toBeGreaterThan(0);');
  }
  body.push(...indent(inner, 2), "});", "");

  return { filename, content: [...header, ...body].join("\n"), command };
}
