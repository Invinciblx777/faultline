/**
 * Evidence event vocabulary. Every event is something the worker directly
 * observed from the browser (or from its own egress guard / fault injector)
 * during one execution.
 */

export const EVIDENCE_KINDS = [
  "lifecycle",
  "navigation",
  "console",
  "page_error",
  "request_failed",
  "http_error",
  "fault_injected",
  "policy_block",
  "journey_step",
  "assertion",
  "screenshot",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  lifecycle: "Lifecycle",
  navigation: "Navigation",
  console: "Console",
  page_error: "Uncaught exception",
  request_failed: "Request failed",
  http_error: "HTTP error response",
  fault_injected: "Injected fault",
  policy_block: "Blocked by safety policy",
  journey_step: "Journey step",
  assertion: "Assertion",
  screenshot: "Screenshot",
};

export const EVIDENCE_SEVERITIES = ["info", "warning", "error"] as const;
export type EvidenceSeverity = (typeof EVIDENCE_SEVERITIES)[number];

export interface EvidenceEvent {
  seq: number;
  kind: EvidenceKind;
  severity: EvidenceSeverity;
  occurredAt: string;
  /** Milliseconds since the execution started. */
  offsetMs: number;
  message: string;
  url?: string | null;
  resourceType?: string | null;
  method?: string | null;
  statusCode?: number | null;
  detail?: Record<string, unknown> | null;
}

/** Hard caps protecting storage from noisy or hostile pages. */
export const EVIDENCE_LIMITS = {
  maxEventsPerExecution: 1000,
  perKind: {
    lifecycle: 50,
    navigation: 50,
    console: 300,
    page_error: 100,
    request_failed: 300,
    http_error: 300,
    fault_injected: 400,
    policy_block: 200,
    journey_step: 120,
    assertion: 80,
    screenshot: 40,
  } satisfies Record<EvidenceKind, number>,
} as const;

/** Aggregate counts stored with each execution for quick display. */
export interface ExecutionSummary {
  totalRequests: number;
  failedRequests: number;
  httpErrors: number;
  consoleErrors: number;
  consoleWarnings: number;
  pageErrors: number;
  intentionallyBlocked: number;
  policyBlocked: number;
  /** Events not stored because a limit was reached, by kind. */
  droppedEvents: Partial<Record<EvidenceKind, number>>;
  /** True if the request budget was exhausted and further requests were refused. */
  requestBudgetExhausted: boolean;
  /** Bytes transferred through the egress guard for this execution. */
  transferredBytes: number | null;
}

export function emptySummary(): ExecutionSummary {
  return {
    totalRequests: 0,
    failedRequests: 0,
    httpErrors: 0,
    consoleErrors: 0,
    consoleWarnings: 0,
    pageErrors: 0,
    intentionallyBlocked: 0,
    policyBlocked: 0,
    droppedEvents: {},
    requestBudgetExhausted: false,
    transferredBytes: null,
  };
}
