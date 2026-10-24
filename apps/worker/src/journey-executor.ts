import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { errors, type Browser, type BrowserContext, type Locator, type Page, type Request, type Response, type Route } from "playwright";
import {
  classifyRequest,
  describeStep,
  findAllowlistMatch,
  isAssertionStep,
  isMutationAllowed,
  matchesDependency,
  redactText,
  redactUrl,
  resolveJourneyUrl,
  type ExecutionOutcome,
  type ExecutionSummary,
  type EvidenceEvent,
  type ExperimentFault,
  type JourneyDefinition,
  type JourneyLocator,
  type JourneyObservation,
  type JourneyStep,
  type JourneyStepType,
  type Party,
  type StepStatus,
} from "@faultline/shared";
import type { EgressPolicy } from "@faultline/shared/network";
import { EgressGuard } from "./egress-guard";
import { EvidenceRecorder } from "./evidence-recorder";
import { guardMarker, hostPort, pngDimensions, withTimeout, type CapturedScreenshot, type ExecutionLimits } from "./executor";

export type RequestOutcome = "completed" | "failed" | "cancelled" | "intercepted" | "pending";
export type InjectionKind = "aborted" | "error-response" | "delayed" | "mutation-blocked";

export interface JourneyViewport {
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export const JOURNEY_VIEWPORTS: Record<"desktop" | "mobile", JourneyViewport> = {
  desktop: { width: 1366, height: 900, isMobile: false, hasTouch: false },
  // Chromium emulation of a large phone CSS viewport; not Safari, not a physical device.
  mobile: { width: 430, height: 932, isMobile: true, hasTouch: true },
};

export interface JourneyExecutionInput {
  browser: Browser;
  /** Authorized project origin. Every journey path resolves against it. */
  origin: string;
  journey: JourneyDefinition;
  fault: ExperimentFault | null;
  viewport: JourneyViewport;
  policy: EgressPolicy;
  limits: ExecutionLimits;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}

export interface StepRecord {
  phase: "journey" | "offline-expectation";
  index: number;
  type: JourneyStepType;
  description: string;
  isAssertion: boolean;
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  offsetMs: number | null;
  durationMs: number | null;
  error: string | null;
  detail: Record<string, unknown> | null;
}

export interface RequestRecord {
  requestId: number;
  url: string;
  method: string;
  resourceType: string;
  origin: string | null;
  party: Party | null;
  isMainDocument: boolean;
  status: number | null;
  outcome: RequestOutcome;
  failureText: string | null;
  injected: InjectionKind | null;
  dependencyKey: string | null;
  stepIndex: number | null;
  startedOffsetMs: number;
  durationMs: number | null;
  fromServiceWorker: boolean;
}

export interface JourneyExecutionResult {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  outcome: ExecutionOutcome | null;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  pageTitle: string | null;
  navigationError: string | null;
  browserName: string;
  browserVersion: string;
  userAgent: string | null;
  viewport: { width: number; height: number; isMobile: boolean };
  events: EvidenceEvent[];
  summary: ExecutionSummary;
  steps: StepRecord[];
  offlineChecks: StepRecord[];
  requests: RequestRecord[];
  requestsDropped: number;
  screenshot: CapturedScreenshot | null;
  stepScreenshots: Array<{ stepIndex: number; shot: CapturedScreenshot }>;
  observation: JourneyObservation;
  interrupted: "cancelled" | "timeout" | null;
  engineError: string | null;
}

/** Request records kept per execution. Beyond this the log is marked incomplete. */
export const MAX_REQUEST_RECORDS = 600;
const QUIET_WINDOW_MS = 300;

const ANSI = /\u001b\[[0-9;]*m/g;

/** Condenses a Playwright error into the lines a developer needs: what failed, expected, received, timeout. */
export function summarizeStepError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(ANSI, "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines[0] ?? "Unknown error";
  const extra = lines.filter((l) => /^(Expected|Received|Timeout|Error):/.test(l) && l !== head).slice(0, 3);
  return redactText([head, ...extra].join(" · "), 500);
}

export function buildLocator(page: Page, locator: JourneyLocator): Locator {
  switch (locator.by) {
    case "role":
      return page.getByRole(locator.role, { name: locator.name, exact: locator.exact }).first();
    case "text":
      return page.getByText(locator.text, { exact: locator.exact }).first();
    case "label":
      return page.getByLabel(locator.label, { exact: locator.exact }).first();
    case "placeholder":
      return page.getByPlaceholder(locator.placeholder, { exact: locator.exact }).first();
    case "testId":
      return page.getByTestId(locator.testId).first();
    case "css":
      // The `css=` prefix pins the selector engine, so selector text is never interpreted as another engine.
      return page.locator(`css=${locator.selector}`).first();
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

class EngineError extends Error {}

/**
 * Runs one journey in a fresh, isolated browser context under at most one
 * fault, and returns only what was observed. Injected events, safety blocks,
 * and naturally occurring failures are recorded separately.
 */
export async function runJourneyExecution(input: JourneyExecutionInput): Promise<JourneyExecutionResult> {
  const { browser, origin, journey, fault, policy, limits } = input;
  const startedAt = new Date();
  const t0 = startedAt.getTime();
  const recorder = new EvidenceRecorder(startedAt);
  const guard = new EgressGuard({ policy, maxTransferBytes: limits.maxTransferBytes });
  const proxy = await guard.start();
  const phase = (p: string) => input.onPhase?.(p);
  const closing = new AbortController();

  const offline = fault?.kind === "offline";
  const networkFault = fault && "matcher" in fault ? fault : null;
  const viewport: JourneyViewport =
    fault?.kind === "narrow-viewport" ? { width: fault.width, height: fault.height, isMobile: true, hasTouch: true } : input.viewport;
  const firstStep = journey.steps[0];
  const requestedUrl = firstStep?.type === "navigate" ? resolveJourneyUrl(origin, firstStep.path) : origin;

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let interrupted: JourneyExecutionResult["interrupted"] = null;
  let engineError: string | null = null;
  let crashed = false;
  let leftScopeUrl: string | null = null;
  let userAgent: string | null = null;
  let finalUrl: string | null = null;
  let pageTitle: string | null = null;
  let screenshot: CapturedScreenshot | null = null;
  const stepScreenshots: JourneyExecutionResult["stepScreenshots"] = [];
  // Assigned inside closures; the cast keeps TypeScript from narrowing it to `null` here.
  let firstNavigation = null as { status: number | null; error: string | null; kind: "timeout" | "network" | "guard" | null } | null;

  const records: RequestRecord[] = [];
  const recordFor = new WeakMap<Request, RequestRecord>();
  const startTimes = new WeakMap<Request, number>();
  const inflight = new Set<Request>();
  /** URLs FAULTLINE injected a fault into, to attribute Chromium's own console messages about them. */
  const injectedUrls = new Set<string>();
  /** Requests FAULTLINE refused for policy reasons (request budget, authorized scope). Not site failures. */
  const policyRefused = new WeakSet<Request>();
  let requestsDropped = 0;
  let requestCount = 0;
  let nextRequestId = 1;
  let currentStep: number | null = null;
  let faultApplications = 0;
  const offscreenSteps: number[] = [];
  let horizontalOverflowPx = 0;

  const steps: StepRecord[] = journey.steps.map((step, index) => ({
    phase: "journey",
    index,
    type: step.type,
    description: describeStep(step),
    isAssertion: isAssertionStep(step),
    status: "not_reached",
    startedAt: null,
    finishedAt: null,
    offsetMs: null,
    durationMs: null,
    error: null,
    detail: null,
  }));
  const offlineChecks: StepRecord[] = [];

  const stepTimeouts = journey.steps.reduce((sum, s) => sum + s.timeoutMs, 0) + journey.offlineExpectations.reduce((sum, s) => sum + s.timeoutMs, 0);
  const budgetMs = Math.min(600_000, Math.max(limits.scenarioTimeoutMs, stepTimeouts + 30_000));

  const abortRun = async (reason: "cancelled" | "timeout") => {
    if (interrupted) return;
    interrupted = reason;
    recorder.lifecycle(reason === "cancelled" ? "Execution cancelled by operator" : `Execution time budget of ${budgetMs} ms reached`);
    closing.abort();
    await context?.close().catch(() => undefined);
  };
  const onAbort = () => void abortRun("cancelled");
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const budgetTimer = setTimeout(() => void abortRun("timeout"), budgetMs);

  const isMainDocument = (request: Request) => {
    try {
      return request.isNavigationRequest() && request.frame().parentFrame() === null;
    } catch {
      return false;
    }
  };

  const track = (request: Request): RequestRecord | null => {
    const existing = recordFor.get(request);
    if (existing) return existing;
    if (startTimes.has(request)) return null;
    const now = Date.now();
    startTimes.set(request, now);
    const url = request.url();
    const main = isMainDocument(request);
    const classified = classifyRequest({ url, method: request.method(), resourceType: request.resourceType(), isMainDocument: main }, origin);
    let reqOrigin: string | null = null;
    try {
      reqOrigin = new URL(url).origin;
    } catch {
      reqOrigin = null;
    }
    if (records.length >= MAX_REQUEST_RECORDS) {
      requestsDropped += 1;
      return null;
    }
    const record: RequestRecord = {
      requestId: nextRequestId++,
      url: redactUrl(url),
      method: request.method(),
      resourceType: request.resourceType(),
      origin: reqOrigin && reqOrigin !== "null" ? reqOrigin : null,
      party: reqOrigin && reqOrigin !== "null" ? (reqOrigin === new URL(origin).origin ? "first-party" : "third-party") : null,
      isMainDocument: main,
      status: null,
      outcome: "pending",
      failureText: null,
      injected: null,
      dependencyKey: classified?.key ?? null,
      stepIndex: currentStep,
      startedOffsetMs: now - t0,
      durationMs: null,
      fromServiceWorker: false,
    };
    recordFor.set(request, record);
    records.push(record);
    return record;
  };

  const settleRecord = (request: Request, outcome: RequestOutcome, failureText: string | null) => {
    inflight.delete(request);
    const record = recordFor.get(request);
    if (!record) return;
    const start = startTimes.get(request);
    record.durationMs = start !== undefined ? Date.now() - start : null;
    record.outcome = outcome;
    record.failureText = failureText ? redactText(failureText, 300) : null;
  };

  try {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      deviceScaleFactor: 1,
      proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
      // Network faults need every request to pass through routing, which service workers would bypass.
      serviceWorkers: offline ? "allow" : "block",
      reducedMotion: "reduce",
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      bypassCSP: false,
      javaScriptEnabled: true,
      permissions: [],
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });
    context.setDefaultNavigationTimeout(limits.navigationTimeoutMs);
    context.setDefaultTimeout(15_000);
    recorder.lifecycle("Fresh browser context created", {
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      serviceWorkers: offline ? "allow" : "block",
      reducedMotion: "reduce",
      fault: fault ?? null,
    });

    page = await context.newPage();
    const mainPage = page;
    userAgent = await withTimeout(page.evaluate(() => navigator.userAgent), 5_000, null);
    context.on("page", (extra) => {
      if (extra !== mainPage) {
        recorder.lifecycle("Closed a popup window opened by the page", { url: redactUrl(extra.url()) });
        void extra.close().catch(() => undefined);
      }
    });
    attachObservers(context, page);
    await context.route("**/*", (route, request) => handleRoute(route, request));

    for (let i = 0; i < journey.steps.length; i++) {
      if (interrupted || crashed) break;
      const step = journey.steps[i]!;
      const record = steps[i]!;
      currentStep = i;
      phase(`Step ${i + 1} of ${journey.steps.length}: ${record.description}`);
      recorder.record({ kind: "journey_step", severity: "info", message: `Step ${i + 1} started: ${record.description}`, detail: { stepIndex: i, type: step.type } });
      const begin = Date.now();
      record.startedAt = new Date(begin);
      record.offsetMs = begin - t0;
      const detail: Record<string, unknown> = {};
      let error: string | null = null;
      try {
        await performStep(page, step, i, detail);
      } catch (caught) {
        if (caught instanceof EngineError) throw caught;
        if (interrupted) break;
        if (crashed || page.isClosed()) {
          if (!leftScopeUrl) throw new EngineError(crashed ? "The browser page crashed." : "The browser page closed unexpectedly.");
          error = "The page navigated outside the authorized origin; FAULTLINE stopped following it.";
        } else {
          error = summarizeStepError(caught);
        }
      }
      const end = Date.now();
      record.finishedAt = new Date(end);
      record.durationMs = end - begin;
      record.status = error ? "failed" : "passed";
      record.error = error;
      record.detail = Object.keys(detail).length ? detail : null;
      recorder.record({
        kind: record.isAssertion ? "assertion" : "journey_step",
        severity: error ? "error" : "info",
        message: `${record.isAssertion ? "Assertion" : "Step"} ${i + 1} ${error ? "failed" : "passed"} in ${record.durationMs} ms: ${record.description}${error ? ` (${error})` : ""}`,
        detail: { stepIndex: i, type: step.type, status: record.status, durationMs: record.durationMs },
      });
      if (error) {
        const shot = await capture(page, false, `step-${i}`);
        if (shot) stepScreenshots.push({ stepIndex: i, shot });
        break;
      }
      if (offline && step.type === "navigate" && faultApplications === 0) {
        await context.setOffline(true);
        faultApplications = 1;
        recorder.record({
          kind: "fault_injected",
          severity: "info",
          message: "Browser context switched offline (Playwright emulation; not physical network loss)",
          detail: { faultKind: "offline", afterStep: i },
        });
      }
    }
    currentStep = null;

    if (!interrupted && !crashed && !page.isClosed()) {
      for (const [index, expectation] of journey.offlineExpectations.entries()) {
        if (!offline) break;
        const description = describeStep(expectation);
        const begin = Date.now();
        let error: string | null = null;
        try {
          await performStep(page, expectation, -1, {});
        } catch (caught) {
          if (interrupted) break;
          error = summarizeStepError(caught);
        }
        const end = Date.now();
        offlineChecks.push({
          phase: "offline-expectation",
          index,
          type: expectation.type,
          description,
          isAssertion: true,
          status: error ? "failed" : "passed",
          startedAt: new Date(begin),
          finishedAt: new Date(end),
          offsetMs: begin - t0,
          durationMs: end - begin,
          error,
          detail: null,
        });
        recorder.record({
          kind: "assertion",
          severity: error ? "error" : "info",
          message: `Offline expectation ${index + 1} ${error ? "not met" : "met"}: ${description}${error ? ` (${error})` : ""}`,
          detail: { offlineExpectation: index },
        });
      }

      if (fault?.kind === "narrow-viewport") {
        const measured = await withTimeout(
          page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
          3_000,
          0,
        );
        horizontalOverflowPx = Number.isFinite(measured) ? Math.max(0, Math.round(measured)) : 0;
        recorder.record({
          kind: "lifecycle",
          severity: horizontalOverflowPx > 0 ? "warning" : "info",
          message:
            horizontalOverflowPx > 0
              ? `Layout check: the page is ${horizontalOverflowPx} px wider than the ${viewport.width} px viewport`
              : `Layout check: no horizontal overflow at ${viewport.width} px`,
          detail: { horizontalOverflowPx, viewportWidth: viewport.width },
        });
      }

      phase("Capturing final screenshot");
      const quiet = await waitForQuiet(Math.min(limits.settleTimeoutMs, 3_000));
      recorder.lifecycle(quiet ? "Page network quiet before final screenshot" : `${inflight.size} requests still in flight; captured the final screenshot anyway`);
      finalUrl = redactUrl(page.url());
      pageTitle = await withTimeout(page.title().then((t) => redactText(t, 300)), 3_000, null);
      if (!leftScopeUrl && page.url() !== "about:blank") screenshot = await capture(page, true, "final");
    }
  } catch (error) {
    if (!interrupted) {
      const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      engineError = redactText(message, 500);
      recorder.record({ kind: "lifecycle", severity: "error", message: `FAULTLINE could not complete this execution: ${engineError}` });
    }
  } finally {
    clearTimeout(budgetTimer);
    input.signal?.removeEventListener("abort", onAbort);
    closing.abort();
    await context?.close().catch(() => undefined);
    await guard.stop();
  }

  for (const block of guard.blocked) {
    recorder.record({
      kind: "policy_block",
      severity: "warning",
      message: block.message,
      url: block.url ?? `${block.via === "connect" ? "tls" : "http"}://${block.host}:${block.port}`,
      detail: { reason: block.reason, via: block.via, at: block.at.toISOString() },
    });
  }
  recorder.summary.policyBlocked += guard.blocked.length;
  recorder.summary.transferredBytes = guard.transferredBytes;
  if (guard.transferBudgetExhausted) recorder.lifecycle(`Transfer budget of ${limits.maxTransferBytes} bytes exhausted; remaining traffic was cut`);
  for (const record of records) {
    // A response arrived but its body was never fully read (for example a page that checks
    // `response.ok` and stops). The exchange itself completed.
    if (record.outcome === "pending" && record.status !== null) record.outcome = "completed";
  }
  if (interrupted && !engineError) engineError = interrupted === "cancelled" ? "Cancelled by operator." : `Execution time budget of ${budgetMs} ms reached.`;

  const finishedAt = new Date();
  const outcome = decideOutcome();
  recorder.lifecycle(`Execution finished${outcome ? `: ${outcome}` : ""}`);

  const allPassed = steps.every((s) => s.status === "passed");
  const first = steps[0];
  const last = steps[steps.length - 1];
  const observation: JourneyObservation = {
    completed: engineError === null,
    engineError,
    steps: steps.map((s) => ({ index: s.index, status: s.status, durationMs: s.durationMs, error: s.error })),
    journeyMs: allPassed && first?.startedAt && last?.finishedAt ? last.finishedAt.getTime() - first.startedAt.getTime() : null,
    captureComplete:
      !recorder.summary.requestBudgetExhausted && requestsDropped === 0 && Object.keys(recorder.summary.droppedEvents).length === 0 && !guard.transferBudgetExhausted,
    faultApplications,
    layout: fault?.kind === "narrow-viewport" ? { horizontalOverflowPx, offscreenSteps } : null,
    offlineChecks: offlineChecks.map((c) => ({ index: c.index, status: c.status, durationMs: c.durationMs, error: c.error })),
  };

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - t0,
    outcome,
    requestedUrl: redactUrl(requestedUrl),
    finalUrl: leftScopeUrl ? redactUrl(leftScopeUrl) : finalUrl,
    httpStatus: firstNavigation?.status ?? null,
    pageTitle,
    navigationError: firstNavigation?.error ?? null,
    browserName: browser.browserType().name(),
    browserVersion: browser.version(),
    userAgent,
    viewport: { width: viewport.width, height: viewport.height, isMobile: viewport.isMobile },
    events: recorder.events,
    summary: recorder.summary,
    steps,
    offlineChecks,
    requests: records,
    requestsDropped,
    screenshot,
    stepScreenshots,
    observation,
    interrupted,
    engineError,
  };

  // --- helpers (closures over execution state) ---

  function decideOutcome(): ExecutionOutcome | null {
    if (engineError && !firstNavigation) return null;
    if (crashed) return "browser_error";
    if (leftScopeUrl) return "left_authorized_scope";
    if (!firstNavigation) return null;
    if (firstNavigation.kind === "guard") return "blocked_by_policy";
    if (firstNavigation.kind === "timeout") return "navigation_timeout";
    if (firstNavigation.kind === "network") {
      if (/ERR_TOO_MANY_REDIRECTS/.test(firstNavigation.error ?? "")) return "too_many_redirects";
      return "navigation_failed";
    }
    if (firstNavigation.status !== null && firstNavigation.status >= 400) return "loaded_with_http_error";
    return "loaded";
  }

  async function waitForQuiet(maxMs: number): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    let quietSince: number | null = null;
    while (Date.now() < deadline && !closing.signal.aborted) {
      if (inflight.size === 0) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= QUIET_WINDOW_MS) return true;
      } else {
        quietSince = null;
      }
      await abortableSleep(50, closing.signal);
    }
    return inflight.size === 0;
  }

  async function navigate(action: () => Promise<Response | null>, isFirst: boolean) {
    let response: Response | null;
    try {
      response = await action();
    } catch (error) {
      if (isFirst && !firstNavigation) {
        firstNavigation = {
          status: null,
          error: summarizeStepError(error),
          kind: error instanceof errors.TimeoutError ? "timeout" : "network",
        };
      }
      throw error;
    }
    const marker = response ? guardMarker(response) : null;
    if (response && marker) {
      const message =
        marker.kind === "upstream-failed"
          ? `Connection to ${redactUrl(response.url())} failed (${marker.code ?? "unknown"}), observed by the FAULTLINE egress guard`
          : `Destination refused by the FAULTLINE egress guard (${marker.code ?? "policy"})`;
      if (isFirst && !firstNavigation) firstNavigation = { status: null, error: message, kind: marker.kind === "blocked" ? "guard" : "network" };
      throw new Error(message);
    }
    if (isFirst && !firstNavigation) firstNavigation = { status: response?.status() ?? null, error: null, kind: null };
    if (response) {
      recorder.record({
        kind: "navigation",
        severity: response.status() >= 400 ? "error" : "info",
        message: `Main document responded ${response.status()} ${redactText(response.statusText(), 80)}`.trim(),
        url: response.url(),
        statusCode: response.status(),
        detail: { fromServiceWorker: response.fromServiceWorker() },
      });
    }
    if (leftScopeUrl) throw new Error("The page navigated outside the authorized origin; FAULTLINE stopped following it.");
  }

  async function checkWithinViewport(target: Locator, stepIndex: number, timeout: number) {
    await target.waitFor({ state: "visible", timeout });
    const box = await target.boundingBox();
    if (!box || box.x < -1 || box.x + box.width > viewport.width + 1) {
      offscreenSteps.push(stepIndex);
      recorder.record({
        kind: "lifecycle",
        severity: "warning",
        message: `Layout check: the control for step ${stepIndex + 1} spans x=${box ? Math.round(box.x) : "?"}..${box ? Math.round(box.x + box.width) : "?"} in a ${viewport.width} px viewport`,
        detail: { stepIndex, box },
      });
    }
  }

  async function performStep(p: Page, step: JourneyStep, stepIndex: number, detail: Record<string, unknown>) {
    switch (step.type) {
      case "navigate": {
        const url = resolveJourneyUrl(origin, step.path);
        recorder.record({ kind: "navigation", severity: "info", message: "Navigation started", url });
        await navigate(() => p.goto(url, { waitUntil: "load", timeout: step.timeoutMs }), firstNavigation === null);
        detail.url = redactUrl(p.url());
        return;
      }
      case "reload":
        recorder.record({ kind: "navigation", severity: "info", message: "Reload started", url: p.url() });
        await navigate(() => p.reload({ waitUntil: "load", timeout: step.timeoutMs }), false);
        return;
      case "click": {
        const target = buildLocator(p, step.target);
        if (fault?.kind === "narrow-viewport") await checkWithinViewport(target, stepIndex, step.timeoutMs);
        await target.click({ timeout: step.timeoutMs });
        return;
      }
      case "fill": {
        const target = buildLocator(p, step.target);
        if (fault?.kind === "narrow-viewport") await checkWithinViewport(target, stepIndex, step.timeoutMs);
        const kind = await target.evaluate(
          (el) => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") ?? "").toLowerCase(), autocomplete: (el.getAttribute("autocomplete") ?? "").toLowerCase() }),
          undefined,
          { timeout: step.timeoutMs },
        );
        if (kind.type === "password" || kind.type === "file" || kind.autocomplete.startsWith("cc-") || kind.autocomplete.includes("password")) {
          throw new Error("FAULTLINE does not fill password, file, or payment card fields.");
        }
        await target.fill(step.value, { timeout: step.timeoutMs });
        return;
      }
      case "waitForVisible":
        await buildLocator(p, step.target).waitFor({ state: "visible", timeout: step.timeoutMs });
        return;
      case "assertVisible":
        await expect(buildLocator(p, step.target)).toBeVisible({ timeout: step.timeoutMs });
        return;
      case "assertHidden":
        await expect(buildLocator(p, step.target)).toBeHidden({ timeout: step.timeoutMs });
        return;
      case "assertEnabled":
        await expect(buildLocator(p, step.target)).toBeEnabled({ timeout: step.timeoutMs });
        return;
      case "assertDisabled":
        await expect(buildLocator(p, step.target)).toBeDisabled({ timeout: step.timeoutMs });
        return;
      case "assertText":
        if (step.match === "equals") await expect(buildLocator(p, step.target)).toHaveText(step.text, { timeout: step.timeoutMs });
        else await expect(buildLocator(p, step.target)).toContainText(step.text, { timeout: step.timeoutMs });
        return;
    }
  }

  async function capture(p: Page, fullPageWanted: boolean, label: string): Promise<CapturedScreenshot | null> {
    try {
      let fullPage = false;
      if (fullPageWanted) {
        const rawHeight = await withTimeout(
          p.evaluate(() => Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0)),
          3_000,
          0,
        );
        const height = Number.isFinite(rawHeight) ? Math.max(0, Math.floor(rawHeight)) : 0;
        fullPage = height > 0 && height <= limits.maxScreenshotHeight;
        if (!fullPage) recorder.lifecycle(`Page height ${height}px is outside the screenshot limit; captured the viewport only`);
      }
      const buffer = await p.screenshot({
        type: "png",
        fullPage,
        animations: "disabled",
        caret: "hide",
        timeout: 15_000,
        mask: journey.maskSelectors.map((selector) => p.locator(`css=${selector}`)),
      });
      const dims = pngDimensions(buffer);
      recorder.record({
        kind: "screenshot",
        severity: "info",
        message: `Screenshot captured (${label === "final" ? "end of journey" : `at failed step ${Number(label.slice(5)) + 1}`})`,
        detail: { label, bytes: buffer.length, ...dims, fullPage, masked: journey.maskSelectors.length },
      });
      return { buffer, sha256: createHash("sha256").update(buffer).digest("hex"), width: dims?.width ?? 0, height: dims?.height ?? 0, fullPage };
    } catch (error) {
      if (!interrupted) recorder.lifecycle(`Screenshot failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      return null;
    }
  }

  function inScope(url: string): boolean {
    if (url === "about:blank" || url.startsWith("chrome-error://")) return true;
    return findAllowlistMatch(url, policy.allowlist) !== null;
  }

  async function handleRoute(route: Route, request: Request) {
    const record = track(request);
    requestCount += 1;
    const url = request.url();
    const method = request.method().toUpperCase();
    const main = isMainDocument(request);

    if (requestCount > limits.maxRequests) {
      if (!recorder.summary.requestBudgetExhausted) {
        recorder.summary.requestBudgetExhausted = true;
        recorder.lifecycle(`Request budget of ${limits.maxRequests} reached; further requests are refused`);
      }
      policyRefused.add(request);
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    if (main && /^https?:/.test(url) && !inScope(url)) {
      leftScopeUrl = url;
      policyRefused.add(request);
      recorder.record({ kind: "policy_block", severity: "warning", message: "Main-frame navigation to an origin outside the scan allowlist was refused", url, method });
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    if (!isMutationAllowed(journey, origin, method, url)) {
      if (record) record.injected = "mutation-blocked";
      recorder.summary.policyBlocked += 1;
      recorder.record({
        kind: "policy_block",
        severity: "warning",
        message: `Blocked a ${method} request: journeys may not change data unless this method and path are explicitly allowed`,
        url,
        method,
        resourceType: request.resourceType(),
        detail: { reason: "mutation_not_allowed", requestId: record?.requestId ?? null },
      });
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    if (networkFault && !main && matchesDependency(networkFault.matcher, { url, method })) {
      faultApplications += 1;
      recorder.summary.intentionallyBlocked += 1;
      injectedUrls.add(url);
      const base = { url, method, resourceType: request.resourceType() };
      const detail = { faultKind: networkFault.kind, requestId: record?.requestId ?? null, stepIndex: currentStep };
      if (networkFault.kind === "unavailable") {
        if (record) record.injected = "aborted";
        recorder.record({ ...base, kind: "fault_injected", severity: "info", message: "Injected: request aborted in the browser (connection refused); the server was not contacted", detail });
        await route.abort(networkFault.abortErrorCode).catch(() => undefined);
        return;
      }
      if (networkFault.kind === "http-error") {
        if (record) record.injected = "error-response";
        recorder.record({
          ...base,
          kind: "fault_injected",
          severity: "info",
          message: `Injected: HTTP ${networkFault.status} response supplied by FAULTLINE; the server was not contacted`,
          statusCode: networkFault.status,
          detail,
        });
        const crossOrigin = (() => {
          try {
            return new URL(url).origin !== new URL(origin).origin;
          } catch {
            return false;
          }
        })();
        await route
          .fulfill({
            status: networkFault.status,
            contentType: "application/json",
            headers: {
              "cache-control": "no-store",
              "x-faultline-injected": "true",
              ...(crossOrigin ? { "access-control-allow-origin": new URL(origin).origin } : {}),
            },
            body: JSON.stringify({ error: `Injected HTTP ${networkFault.status} (FAULTLINE fault experiment)` }),
          })
          .catch(() => undefined);
        return;
      }
      if (record) record.injected = "delayed";
      recorder.record({ ...base, kind: "fault_injected", severity: "info", message: `Injected: request held for ${networkFault.delayMs} ms before being sent`, detail });
      await abortableSleep(networkFault.delayMs, closing.signal);
      if (closing.signal.aborted) return;
      // The page may cancel the request while it is held; continuing it then fails harmlessly.
      await route.continue().catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  }

  function attachObservers(ctx: BrowserContext, p: Page) {
    ctx.on("request", (request) => {
      track(request);
      inflight.add(request);
      if (!isMainDocument(request)) return;
      const redirectedFrom = request.redirectedFrom();
      if (!redirectedFrom) return;
      recorder.record({ kind: "navigation", severity: "info", message: `Redirected from ${redactUrl(redirectedFrom.url())}`, url: request.url() });
      // HTTP redirects are not re-routed through Playwright interception, so scope is checked here too.
      if (/^https?:/.test(request.url()) && !inScope(request.url()) && !leftScopeUrl) {
        leftScopeUrl = request.url();
        recorder.record({ kind: "policy_block", severity: "warning", message: "Main document redirected outside the scan allowlist; evidence collection stopped", url: request.url() });
        void p.close().catch(() => undefined);
      }
    });

    ctx.on("requestfinished", (request) => {
      recorder.summary.totalRequests += 1;
      const record = recordFor.get(request);
      settleRecord(request, record?.injected ? "intercepted" : "completed", null);
    });

    ctx.on("requestfailed", (request) => {
      recorder.summary.totalRequests += 1;
      const failure = request.failure()?.errorText ?? "unknown error";
      const record = recordFor.get(request);
      if (record?.injected || policyRefused.has(request)) {
        settleRecord(request, "intercepted", failure);
        return;
      }
      if (/ERR_ABORTED/.test(failure)) {
        settleRecord(request, "cancelled", failure);
        return;
      }
      settleRecord(request, "failed", failure);
      const target = hostPort(request.url());
      const guardBlock = target ? guard.wasBlocked(target.host, target.port) : undefined;
      if (guardBlock && /TUNNEL_CONNECTION_FAILED|PROXY|ERR_FAILED|blocked/i.test(failure)) return; // recorded from the guard log
      if (offline && /ERR_INTERNET_DISCONNECTED/.test(failure)) {
        recorder.record({
          kind: "request_failed",
          severity: "warning",
          message: `${failure} (the browser context was offline on purpose)`,
          url: request.url(),
          resourceType: request.resourceType(),
          method: request.method(),
          detail: { requestId: record?.requestId ?? null, consequenceOfFaultInjection: true },
        });
        return;
      }
      recorder.summary.failedRequests += 1;
      recorder.record({
        kind: "request_failed",
        severity: "error",
        message: failure,
        url: request.url(),
        resourceType: request.resourceType(),
        method: request.method(),
        detail: { requestId: record?.requestId ?? null, stepIndex: record?.stepIndex ?? null },
      });
    });

    ctx.on("response", (response) => {
      const request = response.request();
      const record = recordFor.get(request);
      if (record) {
        record.status = response.status();
        record.fromServiceWorker = response.fromServiceWorker();
        // An injected response is complete once delivered; the page may never read its body.
        if (record.injected) settleRecord(request, "intercepted", null);
      }
      const status = response.status();
      if (status < 400 || record?.injected) return;
      const marker = guardMarker(response);
      if (marker?.kind === "blocked") return;
      if (marker?.kind === "upstream-failed") {
        recorder.summary.failedRequests += 1;
        recorder.record({
          kind: "request_failed",
          severity: "error",
          message: `Connection failed (${marker.code ?? "unknown"}), observed by the FAULTLINE egress guard`,
          url: response.url(),
          resourceType: request.resourceType(),
          method: request.method(),
          detail: { requestId: record?.requestId ?? null },
        });
        return;
      }
      recorder.summary.httpErrors += 1;
      recorder.record({
        kind: "http_error",
        severity: status >= 500 ? "error" : "warning",
        message: `HTTP ${status} ${redactText(response.statusText(), 80)}`.trim(),
        url: response.url(),
        resourceType: request.resourceType(),
        method: request.method(),
        statusCode: status,
        detail: { requestId: record?.requestId ?? null, stepIndex: record?.stepIndex ?? null },
      });
    });

    p.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      const location = message.location();
      // Chromium logs "Failed to load resource" for requests FAULTLINE faulted on purpose: a
      // consequence of the injection, kept as evidence but not counted as a page error.
      if (location.url && injectedUrls.has(location.url) && message.text().startsWith("Failed to load resource")) {
        recorder.record({
          kind: "console",
          severity: "info",
          message: `${message.text()} (browser message for a request FAULTLINE faulted on purpose)`,
          url: location.url,
          detail: { consequenceOfFaultInjection: true, stepIndex: currentStep },
        });
        return;
      }
      if (offline && message.text().includes("ERR_INTERNET_DISCONNECTED")) {
        recorder.record({ kind: "console", severity: "info", message: `${message.text()} (browser message caused by offline emulation)`, url: location.url || null, detail: { consequenceOfFaultInjection: true } });
        return;
      }
      if (type === "error") recorder.summary.consoleErrors += 1;
      else recorder.summary.consoleWarnings += 1;
      recorder.record({
        kind: "console",
        severity: type === "error" ? "error" : "warning",
        message: message.text(),
        url: location.url || null,
        detail: { ...(location.url ? { line: location.lineNumber, column: location.columnNumber } : {}), stepIndex: currentStep },
      });
    });

    p.on("pageerror", (error) => {
      recorder.summary.pageErrors += 1;
      recorder.record({
        kind: "page_error",
        severity: "error",
        message: `${error.name}: ${error.message}`,
        detail: { ...(error.stack ? { stack: redactText(error.stack, 1500) } : {}), stepIndex: currentStep },
      });
    });

    p.on("dialog", (dialog) => {
      recorder.lifecycle(`Dismissed a ${dialog.type()} dialog opened by the page`);
      void dialog.dismiss().catch(() => undefined);
    });

    p.on("crash", () => {
      crashed = true;
      recorder.record({ kind: "lifecycle", severity: "error", message: "Page crashed" });
    });
  }
}
