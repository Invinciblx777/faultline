import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { conditionsFor, parseAllowlist, scenarioConfigSchema } from "@faultline/shared";
import type { EgressPolicy } from "@faultline/shared/network";
import { pngDimensions, runExecution, type ExecutionLimits } from "../src/executor";
import { listen, startEdgeCaseServer, startReferenceTarget, type RunningServer } from "./fixtures";
import { createServer } from "node:http";

const limits: ExecutionLimits = {
  navigationTimeoutMs: 15_000,
  settleTimeoutMs: 2_000,
  scenarioTimeoutMs: 45_000,
  maxRedirects: 5,
  maxRequests: 500,
  maxTransferBytes: 50 * 1024 * 1024,
  maxScreenshotHeight: 6000,
};

let browser: Browser;
let reference: RunningServer;
let edge: RunningServer;
let other: RunningServer; // a loopback service that is NOT allowlisted
let policy: EgressPolicy;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.FAULTLINE_CHROMIUM_SANDBOX !== "false" });
  reference = await startReferenceTarget();
  other = await listen(createServer((_req, res) => res.end("internal service")));
  edge = await startEdgeCaseServer(() => other.port);
  policy = {
    mode: "local",
    allowlist: parseAllowlist(`${reference.origin}, ${edge.origin}`),
    subresourcePolicy: "public",
  };
});

afterAll(async () => {
  await browser?.close();
  await Promise.all([reference?.close(), edge?.close(), other?.close()]);
});

const blockCss = scenarioConfigSchema.parse({ kind: "resource-block", resourceTypes: ["stylesheet"] });
const offline = scenarioConfigSchema.parse({ kind: "offline-reload" });

describe("baseline execution", () => {
  it("captures real evidence from the reference target", async () => {
    const result = await runExecution({ browser, targetUrl: `${reference.origin}/`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.outcome).toBe("loaded");
    expect(result.httpStatus).toBe(200);
    expect(result.pageTitle).toBe("Northwind Status Board");
    expect(result.finalUrl).toBe(`${reference.origin}/`);
    expect(result.browserName).toBe("chromium");
    expect(result.browserVersion).toMatch(/^\d+\./);
    expect(result.userAgent).toContain("Chrome");

    // The missing banner is a genuine 404 on every load.
    const notFound = result.events.filter((e) => e.kind === "http_error" && e.statusCode === 404);
    expect(notFound.map((e) => e.url)).toContain(`${reference.origin}/assets/missing-banner.png`);
    expect(result.summary.pageErrors).toBe(0);
    expect(result.summary.intentionallyBlocked).toBe(0);
    expect(result.summary.totalRequests).toBeGreaterThanOrEqual(4);

    // Screenshot is a real PNG with a matching hash.
    expect(result.screenshot).not.toBeNull();
    const shot = result.screenshot!;
    expect(pngDimensions(shot.buffer)).toEqual({ width: shot.width, height: shot.height });
    expect(shot.width).toBe(1366);
    expect(shot.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Timeline is ordered and timestamped.
    const offsets = result.events.map((e) => e.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe("resource-block fault execution", () => {
  it("aborts stylesheets, records them as intentional, and observes the resulting exception", async () => {
    const result = await runExecution({ browser, targetUrl: `${reference.origin}/`, conditions: conditionsFor(blockCss, "fault"), policy, limits });
    expect(result.outcome).toBe("loaded");
    const injected = result.events.filter((e) => e.kind === "fault_injected");
    expect(injected.map((e) => e.url)).toEqual([`${reference.origin}/styles.css`]);
    expect(injected[0]?.resourceType).toBe("stylesheet");
    expect(result.summary.intentionallyBlocked).toBe(1);
    // Intentional aborts are not reported as unexpected request failures.
    expect(result.events.filter((e) => e.kind === "request_failed").map((e) => e.url)).not.toContain(`${reference.origin}/styles.css`);
    // The page's CSS-dependent script genuinely throws without the stylesheet.
    const pageErrors = result.events.filter((e) => e.kind === "page_error");
    expect(pageErrors.some((e) => /RangeError/.test(e.message))).toBe(true);
    expect(result.screenshot).not.toBeNull();
    // Chromium's own console message about the aborted stylesheet is attributed to the fault, not counted as a page error.
    const browserNote = result.events.find((e) => e.kind === "console" && e.url === `${reference.origin}/styles.css`);
    expect(browserNote?.severity).toBe("info");
    expect(browserNote?.detail).toMatchObject({ consequenceOfFaultInjection: true });
    expect(result.summary.consoleErrors).toBe(1); // only the genuine 404 for the missing banner
  });
});

describe("offline-reload execution", () => {
  it("baseline reload succeeds online", async () => {
    const result = await runExecution({ browser, targetUrl: `${reference.origin}/`, conditions: conditionsFor(offline, "baseline"), policy, limits });
    expect(result.outcome).toBe("loaded");
    expect(result.events.some((e) => e.message === "Reload started")).toBe(true);
  });

  it("fault reload fails with the browser's offline error and is labeled as emulation", async () => {
    const result = await runExecution({ browser, targetUrl: `${reference.origin}/`, conditions: conditionsFor(offline, "fault"), policy, limits });
    expect(result.outcome).toBe("navigation_failed");
    expect(result.navigationError).toMatch(/ERR_INTERNET_DISCONNECTED/);
    expect(result.events.some((e) => /switched offline \(emulated/.test(e.message))).toBe(true);
  });

  it("observes a service worker serving the page offline when the site supports it", async () => {
    const result = await runExecution({ browser, targetUrl: `${reference.origin}/pwa/`, conditions: conditionsFor(offline, "fault"), policy, limits });
    expect(result.outcome).toBe("loaded");
    const reload = result.events.filter((e) => e.kind === "navigation" && e.statusCode === 200).at(-1);
    expect(reload?.detail).toMatchObject({ fromServiceWorker: true });
  });
});

describe("failure handling", () => {
  it("reports HTTP errors on the main document", async () => {
    const result = await runExecution({ browser, targetUrl: `${edge.origin}/server-error`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.outcome).toBe("loaded_with_http_error");
    expect(result.httpStatus).toBe(500);
  });

  it("reports navigation timeouts", async () => {
    const result = await runExecution({
      browser,
      targetUrl: `${edge.origin}/hang`,
      conditions: conditionsFor(blockCss, "baseline"),
      policy,
      limits: { ...limits, navigationTimeoutMs: 1500 },
    });
    expect(result.outcome).toBe("navigation_timeout");
  });

  it("reports connection failures", async () => {
    const closed = await listen(createServer());
    const port = closed.port;
    await closed.close();
    const target = `http://localhost:${port}/`;
    const result = await runExecution({
      browser,
      targetUrl: target,
      conditions: conditionsFor(blockCss, "baseline"),
      policy: { ...policy, allowlist: parseAllowlist(`http://localhost:${port}`) },
      limits,
    });
    expect(result.outcome).toBe("navigation_failed");
    expect(result.navigationError).toMatch(/ECONNREFUSED/);
    expect(result.screenshot).toBeNull();
  });

  it("captures console errors and uncaught exceptions with redaction", async () => {
    const result = await runExecution({ browser, targetUrl: `${edge.origin}/console`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.summary.consoleErrors).toBeGreaterThanOrEqual(1);
    expect(result.summary.consoleWarnings).toBe(1);
    expect(result.summary.pageErrors).toBe(1);
    const consoleError = result.events.find((e) => e.kind === "console" && e.severity === "error");
    expect(consoleError?.message).toContain("boom");
    expect(consoleError?.message).not.toContain("supersecretvalue");
    expect(result.events.find((e) => e.kind === "page_error")?.message).toMatch(/TypeError/);
  });

  it("stops at redirect loops", async () => {
    const result = await runExecution({ browser, targetUrl: `${edge.origin}/redirect-loop`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.outcome).toBe("too_many_redirects");
  });
});

describe("egress guard enforcement inside the browser", () => {
  it("refuses an allowlisted loopback target in public deployment mode", async () => {
    const result = await runExecution({
      browser,
      targetUrl: `${reference.origin}/`,
      conditions: conditionsFor(blockCss, "baseline"),
      policy: { ...policy, mode: "public" },
      limits,
    });
    expect(result.outcome).toBe("blocked_by_policy");
    expect(result.screenshot).toBeNull();
    expect(result.events.some((e) => e.kind === "policy_block")).toBe(true);
  });

  it("blocks private subresources while the allowlisted page still loads", async () => {
    const result = await runExecution({ browser, targetUrl: `${edge.origin}/private-subresource`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.outcome).toBe("loaded");
    const blocks = result.events.filter((e) => e.kind === "policy_block");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0]?.message).toMatch(/allowlisted/);
    expect(result.summary.failedRequests).toBe(0);
  });

  it("stops when a redirect leaves the authorized scope", async () => {
    const result = await runExecution({ browser, targetUrl: `${edge.origin}/redirect-out`, conditions: conditionsFor(blockCss, "baseline"), policy, limits });
    expect(result.outcome).toBe("left_authorized_scope");
    expect(result.screenshot).toBeNull();
  });

  it("blocks cloud metadata addresses even if a page references them", async () => {
    const result = await runExecution({
      browser,
      targetUrl: "http://169.254.169.254/latest/meta-data/",
      conditions: conditionsFor(blockCss, "baseline"),
      policy: { ...policy, allowlist: parseAllowlist("http://169.254.169.254") },
      limits,
    });
    expect(result.outcome).toBe("blocked_by_policy");
    expect(result.events.find((e) => e.kind === "policy_block")?.detail).toMatchObject({ reason: "metadata_endpoint" });
  });
});
