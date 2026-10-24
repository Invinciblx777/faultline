import { createHash } from "node:crypto";
import { errors, type Browser, type BrowserContext, type Page, type Request, type Response, type Route } from "playwright";
import {
  findAllowlistMatch,
  redactText,
  redactUrl,
  type BlockableResourceType,
  type ExecutionConditions,
  type ExecutionOutcome,
  type ExecutionSummary,
  type EvidenceEvent,
} from "@faultline/shared";
import type { EgressPolicy } from "@faultline/shared/network";
import { EGRESS_BLOCK_HEADER, EgressGuard } from "./egress-guard";
import { EvidenceRecorder } from "./evidence-recorder";

export interface ExecutionLimits {
  navigationTimeoutMs: number;
  settleTimeoutMs: number;
  scenarioTimeoutMs: number;
  maxRedirects: number;
  maxRequests: number;
  maxTransferBytes: number;
  maxScreenshotHeight: number;
}

export interface ExecutionInput {
  browser: Browser;
  targetUrl: string;
  conditions: ExecutionConditions;
  policy: EgressPolicy;
  limits: ExecutionLimits;
  signal?: AbortSignal;
  /** Called at each step so the caller can report progress. */
  onPhase?: (phase: string) => void;
}

export interface CapturedScreenshot {
  buffer: Buffer;
  sha256: string;
  width: number;
  height: number;
  fullPage: boolean;
}

export interface ExecutionResult {
  outcome: ExecutionOutcome;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
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
  screenshot: CapturedScreenshot | null;
  /** True if the execution was stopped by cancellation or the scenario timeout. */
  interrupted: "cancelled" | "timeout" | null;
}

export const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  // Approximates an iPhone 15 Pro Max CSS viewport. Chromium emulation, not Safari.
  mobile: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
} as const;

/** Reads width/height from a PNG IHDR chunk. */
export function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function hostPort(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80 };
  } catch {
    return null;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Interprets the egress guard marker header on a response, if present. */
export function guardMarker(response: Response): { kind: "blocked" | "upstream-failed"; code: string | null } | null {
  const value = response.headers()[EGRESS_BLOCK_HEADER];
  if (!value) return null;
  const code = /(?:code|reason)=([\w-]+)/.exec(value)?.[1] ?? null;
  return { kind: value.startsWith("upstream-failed") ? "upstream-failed" : "blocked", code };
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one execution (baseline or fault) of a scenario in a fresh, isolated
 * browser context and returns only what was actually observed.
 */
export async function runExecution(input: ExecutionInput): Promise<ExecutionResult> {
  const { browser, targetUrl, conditions, policy, limits } = input;
  const startedAt = new Date();
  const recorder = new EvidenceRecorder(startedAt);
  const preset = VIEWPORTS[conditions.viewport];
  const guard = new EgressGuard({ policy, maxTransferBytes: limits.maxTransferBytes });
  const proxy = await guard.start();
  const phase = (p: string) => input.onPhase?.(p);

  let context: BrowserContext | null = null;
  let interrupted: ExecutionResult["interrupted"] = null;
  let crashed = false;
  let leftScopeUrl: string | null = null;
  let tooManyRedirects = false;
  let navigationError: string | null = null;
  let navigationErrorKind: "timeout" | "network" | null = null;
  let mainResponse: Response | null = null;
  let userAgent: string | null = null;
  let screenshot: CapturedScreenshot | null = null;
  let pageTitle: string | null = null;
  let finalUrl: string | null = null;
  const intentionallyBlocked = new WeakSet<Request>();
  /** URLs FAULTLINE aborted on purpose, to attribute Chromium's own console messages about them. */
  const intentionallyBlockedUrls = new Set<string>();
  const policyRefused = new WeakSet<Request>();
  let requestCount = 0;
  /** True when the main document shown is a FAULTLINE guard response rather than website content. */
  let guardDocument = false;

  const abortContext = async (reason: "cancelled" | "timeout") => {
    if (interrupted) return;
    interrupted = reason;
    recorder.lifecycle(reason === "cancelled" ? "Execution cancelled by operator" : `Scenario timeout of ${limits.scenarioTimeoutMs} ms reached`);
    await context?.close().catch(() => undefined);
  };
  const onAbort = () => void abortContext("cancelled");
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const scenarioTimer = setTimeout(() => void abortContext("timeout"), limits.scenarioTimeoutMs);

  try {
    context = await browser.newContext({
      ...preset,
      proxy: { server: proxy.server, username: proxy.username, password: proxy.password },
      serviceWorkers: conditions.serviceWorkers,
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
    context.setDefaultTimeout(Math.min(limits.navigationTimeoutMs, 15_000));
    recorder.lifecycle("Fresh browser context created", {
      viewport: preset.viewport,
      isMobile: preset.isMobile,
      serviceWorkers: conditions.serviceWorkers,
      network: conditions.network,
    });

    const page = await context.newPage();
    userAgent = await withTimeout(page.evaluate(() => navigator.userAgent), 5_000, null);

    // Popups and new windows are closed immediately; FAULTLINE only observes the target page.
    context.on("page", (extra) => {
      if (extra !== page) {
        recorder.lifecycle("Closed a popup window opened by the page", { url: redactUrl(extra.url()) });
        void extra.close().catch(() => undefined);
      }
    });

    attachObservers(page);
    await context.route("**/*", (route, request) => handleRoute(route, request, page));

    // --- Scenario steps ---
    phase(`Navigating to ${redactUrl(targetUrl)}`);
    recorder.record({ kind: "navigation", severity: "info", message: "Navigation started", url: targetUrl });
    mainResponse = await navigate(() => page.goto(targetUrl, { waitUntil: "load", timeout: limits.navigationTimeoutMs }));

    if (!navigationError && !interrupted) {
      recorder.lifecycle("Load event reached");
      await settle(page);
    }

    if (conditions.steps.includes("reload") && !navigationError && !interrupted && !leftScopeUrl) {
      if (conditions.network === "offline-emulation") {
        await context.setOffline(true);
        recorder.lifecycle("Browser context switched offline (emulated; not physical network loss)");
      }
      phase(conditions.network === "offline-emulation" ? "Reloading while offline" : "Reloading");
      recorder.record({ kind: "navigation", severity: "info", message: "Reload started", url: page.url() });
      mainResponse = await navigate(() => page.reload({ waitUntil: "load", timeout: limits.navigationTimeoutMs }));
      if (!navigationError && !interrupted) {
        recorder.lifecycle("Load event reached after reload");
        await settle(page);
      }
    }

    if (!interrupted && !crashed && !page.isClosed()) {
      finalUrl = redactUrl(page.url());
      pageTitle = await withTimeout(page.title().then((t) => redactText(t, 300)), 3_000, null);
      if (!leftScopeUrl && !guardDocument && page.url() !== "about:blank") {
        phase("Capturing screenshot");
        screenshot = await captureScreenshot(page);
      }
    }
  } catch (error) {
    if (!interrupted) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Target page, context or browser has been closed|crash/i.test(message)) crashed = true;
      else throw error;
    }
  } finally {
    clearTimeout(scenarioTimer);
    input.signal?.removeEventListener("abort", onAbort);
    await context?.close().catch(() => undefined);
    await guard.stop();
  }

  // Egress refusals are authoritative evidence from the guard itself.
  for (const block of guard.blocked) {
    recorder.record({
      kind: "policy_block",
      severity: "warning",
      message: block.message,
      url: block.url ?? `${block.via === "connect" ? "tls" : "http"}://${block.host}:${block.port}`,
      detail: { reason: block.reason, via: block.via, at: block.at.toISOString() },
    });
  }
  recorder.summary.policyBlocked = guard.blocked.length;
  recorder.summary.transferredBytes = guard.transferredBytes;
  if (guard.transferBudgetExhausted) {
    recorder.lifecycle(`Transfer budget of ${limits.maxTransferBytes} bytes exhausted; remaining traffic was cut`);
  }

  const outcome = decideOutcome();
  const finishedAt = new Date();
  recorder.lifecycle(`Execution finished: ${outcome}`);

  return {
    outcome,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    requestedUrl: redactUrl(targetUrl),
    finalUrl: leftScopeUrl ? redactUrl(leftScopeUrl) : finalUrl,
    httpStatus: mainResponse?.status() ?? null,
    pageTitle,
    navigationError,
    browserName: browser.browserType().name(),
    browserVersion: browser.version(),
    userAgent,
    viewport: { ...preset.viewport, isMobile: preset.isMobile },
    events: recorder.events,
    summary: recorder.summary,
    screenshot,
    interrupted,
  };

  // --- helpers (closures over execution state) ---

  function decideOutcome(): ExecutionOutcome {
    if (crashed) return "browser_error";
    if (leftScopeUrl) return "left_authorized_scope";
    if (tooManyRedirects) return "too_many_redirects";
    if (navigationErrorKind === "timeout") return "navigation_timeout";
    if (navigationErrorKind === "network") {
      const target = hostPort(targetUrl);
      if (target && guard.wasBlocked(target.host, target.port)) return "blocked_by_policy";
      return "navigation_failed";
    }
    if (interrupted) return "navigation_timeout";
    if (mainResponse && mainResponse.status() >= 400) return "loaded_with_http_error";
    return "loaded";
  }

  async function navigate(action: () => Promise<Response | null>): Promise<Response | null> {
    try {
      const response = await action();
      const marker = response ? guardMarker(response) : null;
      if (response && marker) {
        // The response came from FAULTLINE's egress guard, not from the website.
        navigationErrorKind = "network";
        navigationError =
          marker.kind === "upstream-failed"
            ? `Connection to ${redactUrl(response.url())} failed (${marker.code ?? "unknown"}), observed by the FAULTLINE egress guard`
            : `Destination refused by the FAULTLINE egress guard (${marker.code ?? "policy"})`;
        guardDocument = true;
        recorder.record({ kind: "navigation", severity: "error", message: `Navigation failed: ${navigationError}`, url: response.url() });
        return null;
      }
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
      return response;
    } catch (error) {
      if (interrupted) return null;
      const message = error instanceof Error ? error.message : String(error);
      if (/Target page, context or browser has been closed|Page crashed/i.test(message)) {
        // FAULTLINE closes the page itself when a redirect leaves scope or exceeds the limit.
        if (!leftScopeUrl && !tooManyRedirects) crashed = true;
        return null;
      }
      navigationError = redactText(message.split("\n")[0] ?? message, 500);
      navigationErrorKind = error instanceof errors.TimeoutError ? "timeout" : "network";
      if (/ERR_TOO_MANY_REDIRECTS/.test(message)) tooManyRedirects = true;
      recorder.record({
        kind: "navigation",
        severity: "error",
        message: navigationErrorKind === "timeout" ? `Navigation timed out after ${limits.navigationTimeoutMs} ms` : `Navigation failed: ${navigationError}`,
        url: targetUrl,
      });
      return null;
    }
  }

  async function settle(page: Page) {
    if (limits.settleTimeoutMs <= 0) return;
    phase("Waiting for network to settle");
    try {
      await page.waitForLoadState("networkidle", { timeout: limits.settleTimeoutMs });
      recorder.lifecycle("Network settled (no requests for 500 ms)");
    } catch {
      if (!interrupted) recorder.lifecycle(`Network did not settle within ${limits.settleTimeoutMs} ms; continuing`);
    }
  }

  async function captureScreenshot(page: Page): Promise<CapturedScreenshot | null> {
    try {
      const rawHeight = await withTimeout(
        page.evaluate(() => Math.max(document.documentElement?.scrollHeight ?? 0, document.body?.scrollHeight ?? 0)),
        3_000,
        0,
      );
      const height = Number.isFinite(rawHeight) ? Math.max(0, Math.floor(rawHeight)) : 0;
      const fullPage = height > 0 && height <= limits.maxScreenshotHeight;
      if (!fullPage) {
        recorder.lifecycle(
          height > limits.maxScreenshotHeight
            ? `Page height ${height}px exceeds the ${limits.maxScreenshotHeight}px screenshot limit; captured the viewport only`
            : "Could not measure page height; captured the viewport only",
        );
      }
      const buffer = await page.screenshot({ type: "png", fullPage, animations: "disabled", caret: "hide", timeout: 15_000 });
      const dims = pngDimensions(buffer);
      recorder.lifecycle("Screenshot captured", { bytes: buffer.length, ...dims, fullPage });
      return {
        buffer,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        width: dims?.width ?? 0,
        height: dims?.height ?? 0,
        fullPage,
      };
    } catch (error) {
      if (!interrupted) {
        recorder.lifecycle(`Screenshot failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
      return null;
    }
  }

  function inScope(url: string): boolean {
    if (url === "about:blank" || url.startsWith("chrome-error://")) return true;
    return findAllowlistMatch(url, policy.allowlist) !== null;
  }

  async function handleRoute(route: Route, request: Request, page: Page) {
    requestCount += 1;
    const url = request.url();
    const isMainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();

    if (requestCount > limits.maxRequests) {
      if (!recorder.summary.requestBudgetExhausted) {
        recorder.summary.requestBudgetExhausted = true;
        recorder.lifecycle(`Request budget of ${limits.maxRequests} reached; further requests are refused`);
      }
      policyRefused.add(request);
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    if (isMainNavigation && /^https?:/.test(url) && !inScope(url)) {
      leftScopeUrl = url;
      policyRefused.add(request);
      recorder.record({
        kind: "policy_block",
        severity: "warning",
        message: "Main-frame navigation to an origin outside the scan allowlist was refused",
        url,
        resourceType: request.resourceType(),
        method: request.method(),
      });
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    if (conditions.network === "resource-block" && conditions.blockedResourceTypes) {
      const type = request.resourceType() as BlockableResourceType;
      const scopeOk =
        conditions.blockScope === "all" ||
        (conditions.blockScope === "first-party" && sameOrigin(url, targetUrl)) ||
        (conditions.blockScope === "third-party" && !sameOrigin(url, targetUrl));
      if (conditions.blockedResourceTypes.includes(type) && scopeOk && !isMainNavigation) {
        intentionallyBlocked.add(request);
        intentionallyBlockedUrls.add(url);
        recorder.summary.intentionallyBlocked += 1;
        recorder.record({
          kind: "fault_injected",
          severity: "info",
          message: `Intentionally aborted ${type} request (${conditions.abortErrorCode ?? "failed"})`,
          url,
          resourceType: type,
          method: request.method(),
        });
        await route.abort(conditions.abortErrorCode ?? "failed").catch(() => undefined);
        return;
      }
    }
    await route.continue().catch(() => undefined);
  }

  function attachObservers(page: Page) {
    page.on("request", (request) => {
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      const redirectedFrom = request.redirectedFrom();
      if (!redirectedFrom) return;
      let hops = 0;
      for (let r: Request | null = redirectedFrom; r; r = r.redirectedFrom()) hops += 1;
      recorder.record({
        kind: "navigation",
        severity: "info",
        message: `Redirected (hop ${hops}) from ${redactUrl(redirectedFrom.url())}`,
        url: request.url(),
      });
      if (hops > limits.maxRedirects && !tooManyRedirects) {
        tooManyRedirects = true;
        recorder.lifecycle(`Redirect limit of ${limits.maxRedirects} exceeded; stopping`);
        void page.close().catch(() => undefined);
      }
      // HTTP redirects are not re-routed through Playwright interception, so scope is checked here too.
      if (/^https?:/.test(request.url()) && !inScope(request.url()) && !leftScopeUrl) {
        leftScopeUrl = request.url();
        recorder.record({
          kind: "policy_block",
          severity: "warning",
          message: "Main document redirected outside the scan allowlist; evidence collection stopped",
          url: request.url(),
        });
        void page.close().catch(() => undefined);
      }
    });

    page.on("requestfinished", () => {
      recorder.summary.totalRequests += 1;
    });

    page.on("requestfailed", (request) => {
      recorder.summary.totalRequests += 1;
      if (intentionallyBlocked.has(request) || policyRefused.has(request)) return;
      const failure = request.failure()?.errorText ?? "unknown error";
      const target = hostPort(request.url());
      const guardBlock = target ? guard.wasBlocked(target.host, target.port) : undefined;
      if (guardBlock && /TUNNEL_CONNECTION_FAILED|PROXY|ERR_FAILED|blocked/i.test(failure)) return; // recorded from the guard log
      const upstream = target ? guard.upstreamFailure(target.host, target.port) : undefined;
      recorder.summary.failedRequests += 1;
      recorder.record({
        kind: "request_failed",
        severity: "error",
        message: upstream && /TUNNEL_CONNECTION_FAILED/.test(failure) ? `${failure} (upstream ${upstream.code})` : failure,
        url: request.url(),
        resourceType: request.resourceType(),
        method: request.method(),
      });
    });

    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const marker = guardMarker(response);
      if (marker?.kind === "blocked") return; // guard refusal, recorded from the guard log
      if (marker?.kind === "upstream-failed") {
        recorder.summary.failedRequests += 1;
        recorder.record({
          kind: "request_failed",
          severity: "error",
          message: `Connection failed (${marker.code ?? "unknown"}), observed by the FAULTLINE egress guard`,
          url: response.url(),
          resourceType: response.request().resourceType(),
          method: response.request().method(),
        });
        return;
      }
      recorder.summary.httpErrors += 1;
      recorder.record({
        kind: "http_error",
        severity: status >= 500 ? "error" : "warning",
        message: `HTTP ${status} ${redactText(response.statusText(), 80)}`.trim(),
        url: response.url(),
        resourceType: response.request().resourceType(),
        method: response.request().method(),
        statusCode: status,
      });
    });

    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      const location = message.location();
      // Chromium logs "Failed to load resource" for requests FAULTLINE aborted on purpose.
      // That message is a direct consequence of the injected fault, not page behavior, so it
      // is kept as evidence but not counted as a console error.
      if (location.url && intentionallyBlockedUrls.has(location.url) && message.text().startsWith("Failed to load resource")) {
        recorder.record({
          kind: "console",
          severity: "info",
          message: `${message.text()} (browser message for a request FAULTLINE aborted on purpose)`,
          url: location.url,
          detail: { consequenceOfFaultInjection: true },
        });
        return;
      }
      if (type === "error") recorder.summary.consoleErrors += 1;
      else recorder.summary.consoleWarnings += 1;
      recorder.record({
        kind: "console",
        severity: type === "error" ? "error" : "warning",
        message: message.text(),
        url: location.url || null,
        detail: location.url ? { line: location.lineNumber, column: location.columnNumber } : null,
      });
    });

    page.on("pageerror", (error) => {
      recorder.summary.pageErrors += 1;
      recorder.record({
        kind: "page_error",
        severity: "error",
        message: `${error.name}: ${error.message}`,
        detail: error.stack ? { stack: redactText(error.stack, 1500) } : null,
      });
    });

    page.on("dialog", (dialog) => {
      recorder.lifecycle(`Dismissed a ${dialog.type()} dialog opened by the page`);
      void dialog.dismiss().catch(() => undefined);
    });

    page.on("crash", () => {
      crashed = true;
      recorder.record({ kind: "lifecycle", severity: "error", message: "Page crashed" });
    });

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url() !== "about:blank") {
        recorder.lifecycle("Main frame committed navigation", { url: redactUrl(frame.url()) });
      }
    });
  }
}
