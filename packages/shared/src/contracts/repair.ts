/**
 * FUTURE CONTRACT (Phase "Verified Repair"). Not implemented in Phase 1.
 *
 * Describes the remediation loop: an operator explicitly approves sending a
 * scan's evidence to Devin (API v3) or opening a GitHub issue, a pull request
 * may result, and FAULTLINE independently re-runs the same scenario against
 * the repaired deployment.
 *
 * A repair is never "verified" because a model, a Devin session, or a pull
 * request says so. Only a new FAULTLINE browser execution, compared against
 * the original evidence, determines the observed outcome.
 */

export interface DevinServiceConfig {
  /** Devin API base URL (v3). */
  apiBaseUrl: string;
  /** Server-side environment variable holding the service-user token. Never sent to the browser. */
  tokenEnvVar: string;
  /** Organization or workspace identifier, if required by the API. */
  orgId?: string;
}

export interface ConnectedRepository {
  provider: "github";
  owner: string;
  name: string;
  /** Base branch pull requests must target. */
  baseBranch: string;
  /** The operator confirmed FAULTLINE may act on this repository. */
  authorizedBy: string;
  authorizedAt: string;
}

export type RepairRequestStatus =
  | "awaiting_approval"
  | "approved"
  | "session_started"
  | "pull_request_opened"
  | "verification_queued"
  | "verified_improved"
  | "verified_unchanged"
  | "verified_regressed"
  | "rejected"
  | "failed";

export interface RepairRequest {
  id: string;
  scanId: string;
  repository: ConnectedRepository;
  status: RepairRequestStatus;
  /** Explicit human approval is required before any external call. */
  approvedBy?: string;
  approvedAt?: string;
  devinSessionId?: string;
  pullRequestUrl?: string;
  /** The independent rerun. Its outcome is the only thing that can mark a repair verified. */
  verificationScanId?: string;
}

export interface RepairAgentAdapter {
  readonly id: "devin-v3";
  isConfigured(): { configured: true } | { configured: false; reason: string };
  /** Starts a remediation session. Must only be called for an approved RepairRequest. */
  startSession(request: RepairRequest & { status: "approved" }, reportJson: unknown): Promise<{ sessionId: string }>;
  getSession(sessionId: string): Promise<{ status: string; pullRequestUrl?: string }>;
}

/** Outcome of comparing an original scan with its verification rerun. */
export interface VerificationComparison {
  originalScanId: string;
  verificationScanId: string;
  verdict: "improved" | "unchanged" | "regressed" | "inconclusive";
  /** Facts derived from both scans' recorded evidence. */
  facts: string[];
}
