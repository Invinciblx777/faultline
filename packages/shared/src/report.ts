import type { EvidenceEvent, ExecutionSummary } from "./evidence";
import { describeScenario, type ExecutionConditions, type ScenarioConfig } from "./scenarios";
import {
  EXECUTION_OUTCOME_LABELS,
  EXECUTION_ROLE_LABELS,
  type ExecutionOutcome,
  type ExecutionRole,
  type ExecutionStatus,
  type ScanStatus,
} from "./status";

export const REPORT_SCHEMA = "faultline.report/v1";

export interface ReportArtifact {
  id: string;
  kind: "screenshot";
  contentType: string;
  byteSize: number;
  /** SHA-256 of the stored artifact bytes, hex encoded. Computed by the worker from the real file. */
  sha256: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface ReportExecutionInput {
  id: string;
  role: ExecutionRole;
  status: ExecutionStatus;
  outcome: ExecutionOutcome | null;
  conditions: ExecutionConditions | null;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  pageTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  browserName: string | null;
  browserVersion: string | null;
  userAgent: string | null;
  viewport: { width: number; height: number; isMobile: boolean } | null;
  navigationError: string | null;
  summary: ExecutionSummary | null;
  events: EvidenceEvent[];
  screenshot: ReportArtifact | null;
}

export interface ReportInput {
  generator: { name: string; version: string };
  generatedAt: string;
  project: { id: string; name: string; origin: string };
  scan: {
    id: string;
    targetUrl: string;
    scenario: ScenarioConfig;
    status: ScanStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    environment: ScanEnvironment | null;
  };
  executions: ReportExecutionInput[];
}

/** Environment recorded by the worker when it ran the scan. */
export interface ScanEnvironment {
  workerVersion: string;
  workerId: string;
  playwrightVersion: string;
  browserName: string;
  browserVersion: string;
  headless: boolean;
  chromiumSandbox: boolean;
  deploymentMode: "local" | "public";
  egress: {
    guard: "faultline-egress-proxy";
    subresourcePolicy: "public" | "allowlist";
    privateNetworkAccess: "allowlisted-only" | "denied";
  };
  limits: {
    navigationTimeoutMs: number;
    scenarioTimeoutMs: number;
    settleTimeoutMs: number;
    maxRedirects: number;
    maxRequests: number;
    maxTransferBytes: number;
  };
  platform: string;
  nodeVersion: string;
}

export interface ComparisonFact {
  id: string;
  statement: string;
  tone: "neutral" | "difference" | "failure";
}

export interface FaultlineReport {
  schema: typeof REPORT_SCHEMA;
  generatedAt: string;
  generator: { name: string; version: string };
  project: ReportInput["project"];
  scan: ReportInput["scan"] & { scenarioSummary: string };
  executions: Array<
    Omit<ReportExecutionInput, "events"> & {
      label: string;
      outcomeLabel: string | null;
      events: EvidenceEvent[];
    }
  >;
  comparison: {
    facts: ComparisonFact[];
    consoleErrorsOnlyInFault: string[];
    consoleErrorsOnlyInBaseline: string[];
  };
  interpretation: {
    canConclude: string[];
    cannotConclude: string[];
  };
  integrity: {
    note: string;
  };
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

function consoleErrorSet(execution: ReportExecutionInput | undefined): Set<string> {
  const set = new Set<string>();
  if (!execution) return set;
  for (const event of execution.events) {
    if ((event.kind === "console" && event.severity === "error") || event.kind === "page_error") {
      set.add(normalizeMessage(event.message));
    }
  }
  return set;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Deterministic, rule-based comparison facts. These are restatements of the
 * recorded evidence, not analysis or diagnosis.
 */
export function compareExecutions(
  baseline: ReportExecutionInput | undefined,
  fault: ReportExecutionInput | undefined,
): FaultlineReport["comparison"] {
  const facts: ComparisonFact[] = [];
  const baseErrors = consoleErrorSet(baseline);
  const faultErrors = consoleErrorSet(fault);
  const onlyFault = [...faultErrors].filter((m) => !baseErrors.has(m));
  const onlyBaseline = [...baseErrors].filter((m) => !faultErrors.has(m));

  if (!baseline || !fault) {
    facts.push({
      id: "incomplete",
      statement: "Both executions are required for a comparison; at least one is missing.",
      tone: "failure",
    });
    return { facts, consoleErrorsOnlyInFault: onlyFault, consoleErrorsOnlyInBaseline: onlyBaseline };
  }

  const bo = baseline.outcome;
  const fo = fault.outcome;
  if (bo && fo) {
    if (bo === fo) {
      facts.push({
        id: "outcome-same",
        statement: `Both executions ended with the same outcome: ${EXECUTION_OUTCOME_LABELS[bo]}.`,
        tone: "neutral",
      });
    } else {
      facts.push({
        id: "outcome-changed",
        statement: `Outcome changed from "${EXECUTION_OUTCOME_LABELS[bo]}" under normal conditions to "${EXECUTION_OUTCOME_LABELS[fo]}" under fault conditions.`,
        tone: fo === "loaded" ? "difference" : "failure",
      });
    }
  }

  if (baseline.httpStatus !== fault.httpStatus) {
    facts.push({
      id: "status-changed",
      statement: `Main document HTTP status: ${baseline.httpStatus ?? "none"} (normal) vs ${fault.httpStatus ?? "none"} (fault).`,
      tone: "difference",
    });
  }
  if ((baseline.pageTitle ?? "") !== (fault.pageTitle ?? "")) {
    facts.push({
      id: "title-changed",
      statement: `Page title differed: "${baseline.pageTitle ?? ""}" (normal) vs "${fault.pageTitle ?? ""}" (fault).`,
      tone: "difference",
    });
  }
  if (baseline.finalUrl && fault.finalUrl && baseline.finalUrl !== fault.finalUrl) {
    facts.push({
      id: "final-url-changed",
      statement: `Final URL differed: ${baseline.finalUrl} (normal) vs ${fault.finalUrl} (fault).`,
      tone: "difference",
    });
  }

  const bs = baseline.summary;
  const fs = fault.summary;
  if (fs && fs.intentionallyBlocked > 0) {
    facts.push({
      id: "intentional-blocks",
      statement: `FAULTLINE intentionally aborted ${plural(fs.intentionallyBlocked, "request")} in the fault execution.`,
      tone: "neutral",
    });
  }
  if (bs && fs) {
    if (fs.failedRequests !== bs.failedRequests) {
      facts.push({
        id: "failed-requests",
        statement: `Unexpected request failures (excluding intentional blocks): ${bs.failedRequests} normal vs ${fs.failedRequests} fault.`,
        tone: fs.failedRequests > bs.failedRequests ? "failure" : "difference",
      });
    }
    if (fs.httpErrors !== bs.httpErrors) {
      facts.push({
        id: "http-errors",
        statement: `HTTP error responses: ${bs.httpErrors} normal vs ${fs.httpErrors} fault.`,
        tone: "difference",
      });
    }
    if (fs.totalRequests !== bs.totalRequests) {
      facts.push({
        id: "request-count",
        statement: `Requests issued by the page: ${bs.totalRequests} normal vs ${fs.totalRequests} fault.`,
        tone: "neutral",
      });
    }
  }
  if (onlyFault.length > 0) {
    facts.push({
      id: "errors-only-fault",
      statement: `${plural(onlyFault.length, "distinct console error or exception", "distinct console errors or exceptions")} appeared only under fault conditions.`,
      tone: "failure",
    });
  }
  if (onlyBaseline.length > 0) {
    facts.push({
      id: "errors-only-baseline",
      statement: `${plural(onlyBaseline.length, "distinct console error or exception", "distinct console errors or exceptions")} appeared only under normal conditions.`,
      tone: "difference",
    });
  }
  if (facts.length === 1 && facts[0]?.id === "outcome-same" && onlyFault.length === 0) {
    facts.push({
      id: "no-recorded-difference",
      statement: "No differences were recorded in outcome, status, title, request failures, or console errors.",
      tone: "neutral",
    });
  }
  return { facts, consoleErrorsOnlyInFault: onlyFault, consoleErrorsOnlyInBaseline: onlyBaseline };
}

/** Transparent statements about what this evidence does and does not support. */
export function interpretationFor(input: ReportInput): FaultlineReport["interpretation"] {
  const canConclude: string[] = [];
  const cannotConclude: string[] = [];
  const baseline = input.executions.find((e) => e.role === "baseline");
  const fault = input.executions.find((e) => e.role === "fault");

  if (input.scan.status !== "completed") {
    canConclude.push(
      `The scan did not complete (status: ${input.scan.status}). Only the evidence recorded before it stopped is available.`,
    );
  }
  for (const execution of [baseline, fault]) {
    if (!execution?.outcome) continue;
    const label = EXECUTION_ROLE_LABELS[execution.role].toLowerCase();
    canConclude.push(
      `Under ${label}, a real ${execution.browserName ?? "browser"} ${execution.browserVersion ?? ""} execution recorded: ${EXECUTION_OUTCOME_LABELS[execution.outcome]}${execution.httpStatus ? ` (HTTP ${execution.httpStatus})` : ""}.`.replace(
        /\s+/g,
        " ",
      ),
    );
  }
  if (input.scan.scenario.kind === "resource-block" && fault?.summary) {
    canConclude.push(
      `The fault execution aborted ${plural(fault.summary.intentionallyBlocked, "request")} matching ${describeScenario(input.scan.scenario).replace(/^Abort /, "")}. Every intentionally aborted request is listed separately from unexpected failures.`,
    );
  }
  if (input.scan.scenario.kind === "offline-reload") {
    canConclude.push(
      "The fault execution observed how this page responds to a reload while the browser context reports no network connectivity.",
    );
  }
  canConclude.push("Screenshots and errors in this report come from the two executions listed, captured at the recorded times.");

  cannotConclude.push(
    "Visual or behavioral differences are not automatically defects. FAULTLINE does not know which resources this site is designed to function without.",
  );
  cannotConclude.push(
    "One execution per condition does not establish reproducibility. Network timing, caching, A/B tests, and third-party content can vary between runs.",
  );
  cannotConclude.push("No root cause is asserted. Possible causes require separate investigation or an explicitly labeled hypothesis.");
  if (input.scan.scenario.kind === "offline-reload") {
    cannotConclude.push(
      "Offline was emulated inside the browser context. It does not reproduce physical network loss, captive portals, flaky or slow networks, or operating-system behavior.",
    );
    cannotConclude.push(
      "Whether the page should work offline depends on requirements that are not configured, so the offline outcome is an observation, not a pass or fail verdict.",
    );
  }
  if (input.scan.scenario.kind === "resource-block") {
    cannotConclude.push(
      "Aborting requests inside the browser approximates failed resources. It does not reproduce slow responses, partial content, or server-side failures.",
    );
  }
  const anyBudget = input.executions.some((e) => e.summary?.requestBudgetExhausted);
  const anyDropped = input.executions.some((e) => e.summary && Object.keys(e.summary.droppedEvents).length > 0);
  if (anyBudget || anyDropped) {
    cannotConclude.push(
      "Evidence is incomplete: a request budget or evidence storage limit was reached, so some requests or events were not recorded.",
    );
  }
  return { canConclude, cannotConclude };
}

export function buildReport(input: ReportInput): FaultlineReport {
  const baseline = input.executions.find((e) => e.role === "baseline");
  const fault = input.executions.find((e) => e.role === "fault");
  const ordered = [baseline, fault].filter((e): e is ReportExecutionInput => Boolean(e));
  return {
    schema: REPORT_SCHEMA,
    generatedAt: input.generatedAt,
    generator: input.generator,
    project: input.project,
    scan: { ...input.scan, scenarioSummary: describeScenario(input.scan.scenario) },
    executions: ordered.map((execution) => ({
      ...execution,
      label: EXECUTION_ROLE_LABELS[execution.role],
      outcomeLabel: execution.outcome ? EXECUTION_OUTCOME_LABELS[execution.outcome] : null,
    })),
    comparison: compareExecutions(baseline, fault),
    interpretation: interpretationFor(input),
    integrity: {
      note: "Artifact sha256 values were computed by the worker from the exact bytes written to artifact storage. Recompute them from the downloaded files to verify integrity.",
    },
  };
}
