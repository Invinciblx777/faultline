import { describe, expect, it } from "vitest";
import { emptySummary, type EvidenceEvent } from "../src/evidence";
import { buildReport, REPORT_SCHEMA, type ReportExecutionInput, type ReportInput } from "../src/report";
import { conditionsFor, scenarioConfigSchema } from "../src/scenarios";

const scenario = scenarioConfigSchema.parse({ kind: "resource-block", resourceTypes: ["stylesheet"] });

function event(partial: Partial<EvidenceEvent> & Pick<EvidenceEvent, "kind" | "message">): EvidenceEvent {
  return { seq: 0, severity: "error", occurredAt: "2026-10-24T10:00:00.000Z", offsetMs: 0, ...partial };
}

function execution(role: "baseline" | "fault", overrides: Partial<ReportExecutionInput> = {}): ReportExecutionInput {
  return {
    id: `${role}-id`,
    role,
    status: "completed",
    outcome: "loaded",
    conditions: conditionsFor(scenario, role),
    requestedUrl: "http://localhost:4600/",
    finalUrl: "http://localhost:4600/",
    httpStatus: 200,
    pageTitle: "Reference",
    startedAt: "2026-10-24T10:00:00.000Z",
    finishedAt: "2026-10-24T10:00:02.000Z",
    durationMs: 2000,
    browserName: "chromium",
    browserVersion: "156.0",
    userAgent: "UA",
    viewport: { width: 1366, height: 900, isMobile: false },
    navigationError: null,
    summary: emptySummary(),
    events: [],
    screenshot: null,
    ...overrides,
  };
}

function input(executions: ReportExecutionInput[], status: ReportInput["scan"]["status"] = "completed"): ReportInput {
  return {
    generator: { name: "faultline", version: "0.1.0" },
    generatedAt: "2026-10-24T10:01:00.000Z",
    project: { id: "p", name: "Ref", origin: "http://localhost:4600" },
    scan: {
      id: "s",
      targetUrl: "http://localhost:4600/",
      scenario,
      status,
      createdAt: "2026-10-24T09:59:00.000Z",
      startedAt: "2026-10-24T10:00:00.000Z",
      finishedAt: "2026-10-24T10:00:05.000Z",
      durationMs: 5000,
      errorCode: null,
      errorMessage: null,
      environment: null,
    },
    executions,
  };
}

describe("buildReport", () => {
  it("emits the versioned schema with baseline first", () => {
    const report = buildReport(input([execution("fault"), execution("baseline")]));
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.executions.map((e) => e.role)).toEqual(["baseline", "fault"]);
    expect(report.scan.scenarioSummary).toBe("Abort stylesheets");
  });

  it("states when nothing differed", () => {
    const report = buildReport(input([execution("baseline"), execution("fault")]));
    expect(report.comparison.facts.map((f) => f.id)).toContain("no-recorded-difference");
  });

  it("separates intentional blocks and errors that only appear under fault", () => {
    const faultSummary = { ...emptySummary(), intentionallyBlocked: 3, failedRequests: 1 };
    const report = buildReport(
      input([
        execution("baseline", { events: [event({ kind: "console", message: "shared error" })] }),
        execution("fault", {
          summary: faultSummary,
          events: [
            event({ kind: "console", message: "shared error" }),
            event({ kind: "page_error", message: "TypeError: x is undefined" }),
          ],
        }),
      ]),
    );
    expect(report.comparison.consoleErrorsOnlyInFault).toEqual(["TypeError: x is undefined"]);
    const ids = report.comparison.facts.map((f) => f.id);
    expect(ids).toContain("intentional-blocks");
    expect(ids).toContain("failed-requests");
    expect(ids).toContain("errors-only-fault");
  });

  it("reports outcome changes", () => {
    const report = buildReport(input([execution("baseline"), execution("fault", { outcome: "navigation_failed", httpStatus: null })]));
    const fact = report.comparison.facts.find((f) => f.id === "outcome-changed");
    expect(fact?.statement).toContain("Navigation failed");
    expect(fact?.tone).toBe("failure");
  });

  it("is explicit about limits of what can be concluded", () => {
    const report = buildReport(input([execution("baseline"), execution("fault")]));
    expect(report.interpretation.cannotConclude.join(" ")).toMatch(/not automatically defects/);
    expect(report.interpretation.cannotConclude.join(" ")).toMatch(/No root cause is asserted/);
  });

  it("flags incomplete scans and missing executions", () => {
    const report = buildReport(input([execution("baseline")], "failed"));
    expect(report.comparison.facts[0]?.id).toBe("incomplete");
    expect(report.interpretation.canConclude[0]).toMatch(/did not complete/);
  });

  it("flags incomplete evidence when limits were hit", () => {
    const summary = { ...emptySummary(), droppedEvents: { console: 12 } };
    const report = buildReport(input([execution("baseline", { summary }), execution("fault")]));
    expect(report.interpretation.cannotConclude.join(" ")).toMatch(/Evidence is incomplete/);
  });
});

describe("scenario schema", () => {
  it("dedupes and sorts resource types and applies defaults", () => {
    const parsed = scenarioConfigSchema.parse({ kind: "resource-block", resourceTypes: ["image", "stylesheet", "image"] });
    expect(parsed).toEqual({ kind: "resource-block", resourceTypes: ["image", "stylesheet"], scope: "all", abortErrorCode: "failed", viewport: "desktop" });
  });
  it("rejects document blocking and empty selections", () => {
    expect(scenarioConfigSchema.safeParse({ kind: "resource-block", resourceTypes: ["document"] }).success).toBe(false);
    expect(scenarioConfigSchema.safeParse({ kind: "resource-block", resourceTypes: [] }).success).toBe(false);
  });
  it("labels offline as browser-context emulation", () => {
    const offline = scenarioConfigSchema.parse({ kind: "offline-reload" });
    expect(conditionsFor(offline, "fault").notes.join(" ")).toMatch(/not physical device network loss/);
  });
});
