/**
 * Lifecycle vocabulary shared by the web application, the worker, and reports.
 *
 * A scan's status describes whether FAULTLINE managed to perform the scan.
 * It says nothing about whether the scanned website behaved well. A website
 * that fails to load is still a `completed` scan with a `navigation_failed`
 * execution outcome. A `failed` scan means FAULTLINE itself could not finish
 * (worker crash, browser launch failure, storage failure, policy refusal before
 * execution, and so on).
 */

export const SCAN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const TERMINAL_SCAN_STATUSES: readonly ScanStatus[] = ["completed", "failed", "cancelled"];

export function isTerminalScanStatus(status: ScanStatus): boolean {
  return TERMINAL_SCAN_STATUSES.includes(status);
}

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const EXECUTION_ROLES = ["baseline", "fault"] as const;
export type ExecutionRole = (typeof EXECUTION_ROLES)[number];

export const EXECUTION_ROLE_LABELS: Record<ExecutionRole, string> = {
  baseline: "Normal conditions",
  fault: "Fault conditions",
};

export const EXECUTION_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * What FAULTLINE observed when the browser tried to load the target.
 */
export const EXECUTION_OUTCOMES = [
  "loaded",
  "loaded_with_http_error",
  "navigation_timeout",
  "navigation_failed",
  "blocked_by_policy",
  "left_authorized_scope",
  "too_many_redirects",
  "browser_error",
] as const;
export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];

export const EXECUTION_OUTCOME_LABELS: Record<ExecutionOutcome, string> = {
  loaded: "Page loaded",
  loaded_with_http_error: "Loaded with HTTP error",
  navigation_timeout: "Navigation timed out",
  navigation_failed: "Navigation failed",
  blocked_by_policy: "Blocked by egress policy",
  left_authorized_scope: "Left authorized scope",
  too_many_redirects: "Too many redirects",
  browser_error: "Browser error",
};

export const EXECUTION_OUTCOME_DESCRIPTIONS: Record<ExecutionOutcome, string> = {
  loaded: "The main document responded successfully and the page reached the load event.",
  loaded_with_http_error: "The main document responded with an HTTP status of 400 or above.",
  navigation_timeout: "The page did not finish navigating within the configured timeout.",
  navigation_failed: "The browser reported a network-level navigation error.",
  blocked_by_policy:
    "FAULTLINE's egress guard refused the destination (for example a private network address).",
  left_authorized_scope:
    "The page redirected to an origin that is not on the authorized scan allowlist. Evidence collection stopped.",
  too_many_redirects: "The main document exceeded the configured redirect limit.",
  browser_error: "The browser or page crashed while the scenario was executing.",
};

/** Outcomes where the page arguably rendered something worth comparing. */
export function outcomeRendered(outcome: ExecutionOutcome | null | undefined): boolean {
  return outcome === "loaded" || outcome === "loaded_with_http_error";
}

/**
 * Visual tone used by the UI. Kept here so reports and UI stay consistent.
 * - failure: something was observed failing
 * - success: observed and verified working
 * - running: in progress
 * - incomplete: did not finish / partial
 * - unavailable: capability not present
 */
export type EvidenceTone = "failure" | "success" | "running" | "incomplete" | "unavailable" | "neutral";

export function scanStatusTone(status: ScanStatus): EvidenceTone {
  switch (status) {
    case "queued":
      return "neutral";
    case "running":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "failure";
    case "cancelled":
      return "incomplete";
  }
}

export function outcomeTone(outcome: ExecutionOutcome | null | undefined): EvidenceTone {
  if (!outcome) return "incomplete";
  if (outcome === "loaded") return "success";
  return "failure";
}
