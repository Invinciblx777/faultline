import { sql } from "drizzle-orm";
import {
  bigint,
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  DependencyMatcher,
  DependencyScope,
  EvidenceKind,
  ExperimentFault,
  ExperimentKind,
  FaultKind,
  JourneyDefinition,
  Party,
  Reproducibility,
  RepairEvidenceBundle,
  RepairStatus,
  CandidateRecipe,
  CheckStatus,
  VerificationVerdict,
  Verdict,
  VerdictReason,
  EvidenceSeverity,
  ExecutionConditions,
  ExecutionOutcome,
  ExecutionRole,
  ExecutionStatus,
  ExecutionSummary,
  ScanEnvironment,
  ScanStatus,
  ScenarioConfig,
  ScenarioKind,
} from "@faultline/shared";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

/** Self-hosted operator accounts. Passwords are stored only as scrypt hashes. */
export const operators = pgTable(
  "operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    ...timestamps,
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("operators_username_key").on(sql`lower(${t.username})`)],
);

/** Server-side sessions. Only a SHA-256 hash of the session token is stored. */
export const operatorSessions = pgTable(
  "operator_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "cascade" }),
    ...timestamps,
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("operator_sessions_token_hash_key").on(t.tokenHash), index("operator_sessions_operator_idx").on(t.operatorId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Normalized origin, e.g. https://example.com. Must be allowlisted when created and when scanned. */
    origin: text("origin").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("projects_created_at_idx").on(t.createdAt)],
);

/**
 * Versioned journey definitions. Rows are immutable: editing a journey inserts
 * a new version with the same lineage, so every analysis points at the exact
 * definition it ran.
 */
export const journeys = pgTable(
  "journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lineageId: uuid("lineage_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<JourneyDefinition>().notNull(),
    createdBy: uuid("created_by").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("journeys_lineage_version_key").on(t.lineageId, t.version), index("journeys_project_idx").on(t.projectId)],
);

/** Analysis-level facts recorded by the worker for a Blast Radius scan. */
export interface AnalysisSummary {
  baselineExecutionId: string | null;
  calibrationExecutionId: string | null;
  /** Steps that did not pass in both normal runs, with the reason. */
  excludedSteps: Array<{ index: number; reason: string }>;
  stableSteps: number[];
  calibration: { screenshotDiffRatio: number | null; comparedPixels: number | null; note: string } | null;
  visualThreshold: { ratio: number; explanation: string } | null;
  skippedCandidates: Array<{ dependencyKey: string; fault: FaultKind; reason: string }>;
  dependencyCount: number;
  plannedExperiments: number;
}

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetUrl: text("target_url").notNull(),
    scenarioKind: text("scenario_kind").$type<ScenarioKind>().notNull(),
    scenarioConfig: jsonb("scenario_config").$type<ScenarioConfig>().notNull(),
    status: text("status").$type<ScanStatus>().notNull().default("queued"),
    /** Short human-readable description of the current step while running. */
    phase: text("phase"),
    jobId: text("job_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    environment: jsonb("environment").$type<ScanEnvironment>(),
    /** Blast Radius only: the journey row that was run and a frozen copy of its definition. */
    journeyId: uuid("journey_id").references(() => journeys.id, { onDelete: "set null" }),
    journeySnapshot: jsonb("journey_snapshot").$type<{ id: string; lineageId: string; version: number; definition: JourneyDefinition }>(),
    analysis: jsonb("analysis").$type<AnalysisSummary>(),
    workerId: text("worker_id"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("scans_project_created_idx").on(t.projectId, t.createdAt),
    index("scans_status_idx").on(t.status),
  ],
);

export const scanExecutions = pgTable(
  "scan_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    role: text("role").$type<ExecutionRole>().notNull(),
    /** Distinguishes multiple executions with the same role (experiment attempts). Always 0 for Phase 1 scans. */
    ordinal: integer("ordinal").notNull().default(0),
    experimentId: uuid("experiment_id").references((): AnyPgColumn => experiments.id, { onDelete: "set null" }),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").$type<ExecutionStatus>().notNull().default("pending"),
    outcome: text("outcome").$type<ExecutionOutcome>(),
    conditions: jsonb("conditions").$type<ExecutionConditions>().notNull(),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    httpStatus: integer("http_status"),
    pageTitle: text("page_title"),
    navigationError: text("navigation_error"),
    browserName: text("browser_name"),
    browserVersion: text("browser_version"),
    userAgent: text("user_agent"),
    viewport: jsonb("viewport").$type<{ width: number; height: number; isMobile: boolean }>(),
    summary: jsonb("summary").$type<ExecutionSummary>(),
    failureMessage: text("failure_message"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [uniqueIndex("scan_executions_scan_role_ordinal_key").on(t.scanId, t.role, t.ordinal), index("scan_executions_experiment_idx").on(t.experimentId)],
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => scanExecutions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").$type<EvidenceKind>().notNull(),
    severity: text("severity").$type<EvidenceSeverity>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    offsetMs: integer("offset_ms").notNull(),
    message: text("message").notNull(),
    url: text("url"),
    resourceType: text("resource_type"),
    method: text("method"),
    statusCode: integer("status_code"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex("execution_events_execution_seq_key").on(t.executionId, t.seq)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => scanExecutions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    /** Journey step a step screenshot belongs to. */
    stepIndex: integer("step_index"),
    /** Object key generated from server-side UUIDs only; never derived from page content. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    ...timestamps,
  },
  (t) => [uniqueIndex("artifacts_storage_key_key").on(t.storageKey), index("artifacts_execution_idx").on(t.executionId)],
);

export type ArtifactKind = "screenshot" | "step-screenshot" | "diff";

/** Dependencies observed in an analysis's baseline run. */
export const dependencies = pgTable(
  "dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    scope: text("scope").$type<DependencyScope>().notNull(),
    party: text("party").$type<Party>().notNull(),
    origin: text("origin").notNull(),
    method: text("method"),
    pathPattern: text("path_pattern"),
    resourceTypes: jsonb("resource_types").$type<string[]>().notNull(),
    matcher: jsonb("matcher").$type<DependencyMatcher>().notNull(),
    requestCount: integer("request_count").notNull(),
    failedCount: integer("failed_count").notNull(),
    statuses: jsonb("statuses").$type<number[]>().notNull(),
    medianDurationMs: integer("median_duration_ms"),
    sampleUrls: jsonb("sample_urls").$type<string[]>().notNull(),
    eligibleFaults: jsonb("eligible_faults").$type<FaultKind[]>().notNull(),
    ineligibleReason: text("ineligible_reason"),
    /** Journey steps active when this dependency was requested in the baseline. */
    requestedDuringSteps: jsonb("requested_during_steps").$type<number[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("dependencies_scan_key_key").on(t.scanId, t.key)],
);

export type ExperimentStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ExperimentVisual {
  diffRatio: number | null;
  threshold: number | null;
  significant: boolean | null;
  note: string;
  diffArtifactId: string | null;
}

export interface ExperimentNewError {
  kind: string;
  message: string;
  executionId: string;
  seq: number;
}

/** One isolated fault experiment within a Blast Radius analysis. */
export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").$type<ExperimentKind>().notNull(),
    dependencyId: uuid("dependency_id").references(() => dependencies.id, { onDelete: "set null" }),
    dependencyKey: text("dependency_key"),
    dependencyLabel: text("dependency_label"),
    fault: jsonb("fault").$type<ExperimentFault>().notNull(),
    status: text("status").$type<ExperimentStatus>().notNull().default("pending"),
    verdict: text("verdict").$type<Verdict>(),
    reproducibility: text("reproducibility").$type<Reproducibility>(),
    reasons: jsonb("reasons").$type<VerdictReason[]>().notNull().default([]),
    affectedSteps: jsonb("affected_steps").$type<number[]>().notNull().default([]),
    usableAssertions: jsonb("usable_assertions").$type<number[]>().notNull().default([]),
    excludedSteps: jsonb("excluded_steps").$type<Array<{ index: number; reason: string }>>().notNull().default([]),
    newErrors: jsonb("new_errors").$type<ExperimentNewError[]>().notNull().default([]),
    /** Requests the fault acted on in the first attempt. */
    affectedRequestCount: integer("affected_request_count").notNull().default(0),
    /** Non-injected request failures that appeared only under this fault. */
    newFailedRequestCount: integer("new_failed_request_count").notNull().default(0),
    visual: jsonb("visual").$type<ExperimentVisual>(),
    failureMessage: text("failure_message"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [uniqueIndex("experiments_scan_ordinal_key").on(t.scanId, t.ordinal), index("experiments_verdict_idx").on(t.verdict)],
);

export type RequestOutcome = "completed" | "failed" | "cancelled" | "intercepted" | "pending";
export type InjectionKind = "aborted" | "error-response" | "delayed" | "mutation-blocked";

/** Sanitized network log of one journey execution. No headers, cookies, or bodies. */
export const networkRequests = pgTable(
  "network_requests",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => scanExecutions.id, { onDelete: "cascade" }),
    requestId: integer("request_id").notNull(),
    url: text("url").notNull(),
    method: text("method").notNull(),
    resourceType: text("resource_type").notNull(),
    origin: text("origin"),
    party: text("party").$type<Party>(),
    isMainDocument: boolean("is_main_document").notNull().default(false),
    status: integer("status"),
    outcome: text("outcome").$type<RequestOutcome>().notNull(),
    failureText: text("failure_text"),
    injected: text("injected").$type<InjectionKind>(),
    dependencyKey: text("dependency_key"),
    stepIndex: integer("step_index"),
    startedOffsetMs: integer("started_offset_ms").notNull(),
    durationMs: integer("duration_ms"),
    fromServiceWorker: boolean("from_service_worker").notNull().default(false),
  },
  (t) => [uniqueIndex("network_requests_execution_request_key").on(t.executionId, t.requestId)],
);

export type StepResultStatus = "passed" | "failed" | "not_reached";

/** Outcome of each journey step (and each offline expectation) in one execution. */
export const stepResults = pgTable(
  "step_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => scanExecutions.id, { onDelete: "cascade" }),
    phase: text("phase").$type<"journey" | "offline-expectation">().notNull(),
    stepIndex: integer("step_index").notNull(),
    stepType: text("step_type").notNull(),
    description: text("description").notNull(),
    isAssertion: boolean("is_assertion").notNull(),
    status: text("status").$type<StepResultStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    offsetMs: integer("offset_ms"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex("step_results_execution_phase_step_key").on(t.executionId, t.phase, t.stepIndex)],
);

export type RegressionValidationStatus = "not_run" | "fails_as_expected" | "passes" | "error";

/** Executable Playwright regression test generated for a finding. */
export const regressionTests = pgTable(
  "regression_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
    sha256: text("sha256").notNull(),
    command: text("command").notNull(),
    validationStatus: text("validation_status").$type<RegressionValidationStatus>().notNull().default("not_run"),
    validationSummary: text("validation_summary"),
    validationOutput: text("validation_output"),
    validatedAt: timestamp("validated_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("regression_tests_experiment_key").on(t.experimentId)],
);

/** Liveness of worker processes, so the UI can say truthfully whether scans will be picked up. */
export const workerInstances = pgTable("worker_instances", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  hostname: text("hostname").notNull(),
  browserName: text("browser_name"),
  browserVersion: text("browser_version"),
  playwrightVersion: text("playwright_version"),
  deploymentMode: text("deployment_mode").notNull(),
  concurrency: integer("concurrency").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: "date" }),
});

/**
 * A GitHub repository an operator linked to a project as the source Devin may
 * change. The server's FAULTLINE_REPAIR_REPOSITORIES list authorizes which
 * repositories may be linked; connection checks are recorded as facts.
 */
export const sourceRepositories = pgTable(
  "source_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"github">().notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    baseBranch: text("base_branch").notNull(),
    appDir: text("app_dir"),
    /** How a runnable candidate is obtained (data, never shell). */
    recipe: jsonb("recipe").$type<CandidateRecipe>().notNull(),
    linkedBy: uuid("linked_by").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Last connection check: GitHub repository and branch, and Devin's view of the repository. */
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }),
    githubStatus: text("github_status").$type<"ok" | "error" | "not_checked">().notNull().default("not_checked"),
    githubDetail: text("github_detail"),
    baseSha: text("base_sha"),
    devinStatus: text("devin_status").$type<"ok" | "error" | "not_configured" | "not_checked">().notNull().default("not_checked"),
    devinDetail: text("devin_detail"),
    /** Devin's identifier for the repository (repo_full_name), passed as `repos` on session creation. */
    devinRepoName: text("devin_repo_name"),
    /** When Devin's access to the repository was last checked live; approval requires a recent check. */
    devinCheckedAt: timestamp("devin_checked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("source_repositories_project_key").on(t.projectId)],
);

export interface DevinAttachmentRecord {
  artifactId: string;
  name: string;
  sha256: string;
  /** Devin attachment id and URL as returned by the upload API; null when the upload failed. */
  attachmentId: string | null;
  url: string | null;
  error: string | null;
}

/** One operator-approved request for Devin to repair one finding. */
export const repairRequests = pgTable(
  "repair_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => sourceRepositories.id, { onDelete: "no action" }),
    /** Frozen copy of the linked repository at request time. */
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    baseBranch: text("base_branch").notNull(),
    baseSha: text("base_sha"),
    status: text("status").$type<RepairStatus>().notNull().default("awaiting_approval"),
    statusDetail: text("status_detail"),
    evidence: jsonb("evidence").$type<RepairEvidenceBundle>().notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    prompt: text("prompt").notNull(),
    promptSha256: text("prompt_sha256").notNull(),
    regressionTestId: uuid("regression_test_id")
      .notNull()
      .references(() => regressionTests.id, { onDelete: "no action" }),
    regressionTestSha256: text("regression_test_sha256").notNull(),
    createdBy: uuid("created_by").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => operators.id, { onDelete: "set null" }),
    approvedByUsername: text("approved_by_username"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    approvalStatement: text("approval_statement"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    /** Tag placed on the Devin session so an interrupted submission can be found instead of repeated. */
    devinTag: text("devin_tag").notNull(),
    workerId: text("worker_id"),
    submitStartedAt: timestamp("submit_started_at", { withTimezone: true, mode: "date" }),
    attachments: jsonb("attachments").$type<DevinAttachmentRecord[]>().notNull().default([]),
    devinSessionId: text("devin_session_id"),
    devinSessionUrl: text("devin_session_url"),
    devinStatus: text("devin_status"),
    devinStatusDetail: text("devin_status_detail"),
    devinCreatedAt: timestamp("devin_created_at", { withTimezone: true, mode: "date" }),
    devinUpdatedAt: timestamp("devin_updated_at", { withTimezone: true, mode: "date" }),
    /** As Devin reports it (fractional ACUs). Zero or null means Devin has not reported usage. */
    devinAcusConsumed: doublePrecision("devin_acus_consumed"),
    messagesCursor: text("messages_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
    syncError: text("sync_error"),
    syncFailures: integer("sync_failures").notNull().default(0),
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    prState: text("pr_state"),
    prMerged: boolean("pr_merged"),
    prDraft: boolean("pr_draft"),
    prTitle: text("pr_title"),
    prBaseRef: text("pr_base_ref"),
    prHeadRef: text("pr_head_ref"),
    prHeadSha: text("pr_head_sha"),
    prCreatedAt: timestamp("pr_created_at", { withTimezone: true, mode: "date" }),
    prUpdatedAt: timestamp("pr_updated_at", { withTimezone: true, mode: "date" }),
    prCheckedAt: timestamp("pr_checked_at", { withTimezone: true, mode: "date" }),
    prNotes: jsonb("pr_notes").$type<string[]>().notNull().default([]),
    /** Bullets under the pull request description's "Known limitations" heading, quoted as the agent wrote them. */
    prAgentLimitations: jsonb("pr_agent_limitations").$type<string[]>().notNull().default([]),
    latestVerificationId: uuid("latest_verification_id"),
    verdict: text("verdict").$type<VerificationVerdict>(),
    verdictRationale: jsonb("verdict_rationale").$type<string[]>(),
    verifiedSha: text("verified_sha"),
    verdictAt: timestamp("verdict_at", { withTimezone: true, mode: "date" }),
    /** FAULTLINE's verdict comment on the pull request: one per verification run, never posted twice. */
    verdictCommentId: bigint("verdict_comment_id", { mode: "number" }),
    verdictCommentUrl: text("verdict_comment_url"),
    verdictCommentRunId: uuid("verdict_comment_run_id"),
    verdictCommentPostedAt: timestamp("verdict_comment_posted_at", { withTimezone: true, mode: "date" }),
    verdictCommentClaimedAt: timestamp("verdict_comment_claimed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // One open repair per finding: double clicks and reloads cannot create a second request.
    uniqueIndex("repair_requests_open_experiment_key")
      .on(t.experimentId)
      .where(sql`${t.status} not in ('cancelled', 'devin_failed')`),
    uniqueIndex("repair_requests_devin_tag_key").on(t.devinTag),
    uniqueIndex("repair_requests_devin_session_key").on(t.devinSessionId),
    index("repair_requests_status_idx").on(t.status),
    index("repair_requests_project_idx").on(t.projectId, t.createdAt),
  ],
);

export type RepairEventSource = "faultline" | "operator" | "devin" | "github" | "verification";

/** Append-only audit trail of a repair: approvals, Devin messages and status changes, PR facts, verification. */
export const repairEvents = pgTable(
  "repair_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairRequests.id, { onDelete: "cascade" }),
    source: text("source").$type<RepairEventSource>().notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    /** Devin message event_id, for de-duplication across polls. */
    externalId: text("external_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    operatorId: uuid("operator_id").references(() => operators.id, { onDelete: "set null" }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("repair_events_repair_idx").on(t.repairId, t.id), uniqueIndex("repair_events_external_key").on(t.repairId, t.externalId)],
);

export type VerificationRunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

/** One independent verification of a candidate commit. */
export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairRequests.id, { onDelete: "cascade" }),
    status: text("status").$type<VerificationRunStatus>().notNull().default("queued"),
    phase: text("phase"),
    requestedBy: uuid("requested_by").references(() => operators.id, { onDelete: "set null" }),
    originalSha: text("original_sha").notNull(),
    candidateSha: text("candidate_sha").notNull(),
    prNumber: integer("pr_number").notNull(),
    regressionTestSha256: text("regression_test_sha256").notNull(),
    /** How each revision was built and identified (archive hash, container, image digest, origin). */
    builds: jsonb("builds").$type<Record<string, unknown>>(),
    verdict: text("verdict").$type<VerificationVerdict>(),
    rationale: jsonb("rationale").$type<string[]>(),
    errorMessage: text("error_message"),
    workerId: text("worker_id"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("verification_runs_repair_idx").on(t.repairId, t.createdAt),
    index("verification_runs_status_idx").on(t.status),
    // One active verification per repair.
    uniqueIndex("verification_runs_active_key")
      .on(t.repairId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

export type VerificationStage = "original-normal" | "original-fault" | "original-fault-evidence" | "candidate-fault" | "candidate-fault-evidence" | "candidate-normal";

/** One browser execution inside a verification run, with its evidence. */
export const verificationChecks = pgTable(
  "verification_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => verificationRuns.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    stage: text("stage").$type<VerificationStage>().notNull(),
    revision: text("revision").$type<"original" | "candidate">().notNull(),
    sha: text("sha").notNull(),
    targetOrigin: text("target_origin").notNull(),
    /** `regression-test` runs the stored test file with Playwright Test; `journey` runs the journey engine. */
    method: text("method").$type<"regression-test" | "journey">().notNull(),
    /** `verdict` checks decide the outcome; `evidence` checks only record screenshots and errors. */
    purpose: text("purpose").$type<"verdict" | "evidence">().notNull(),
    attempt: integer("attempt").notNull().default(1),
    faultApplied: boolean("fault_applied").notNull(),
    status: text("status").$type<CheckStatus | "running">().notNull().default("running"),
    summary: text("summary"),
    output: text("output"),
    steps: jsonb("steps").$type<Array<{ index: number; description: string; status: string; error: string | null; durationMs: number | null }>>(),
    errors: jsonb("errors").$type<Array<{ kind: string; message: string }>>(),
    faultApplications: integer("fault_applications"),
    screenshotKey: text("screenshot_key"),
    screenshotSha256: text("screenshot_sha256"),
    screenshotBytes: integer("screenshot_bytes"),
    screenshotWidth: integer("screenshot_width"),
    screenshotHeight: integer("screenshot_height"),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
  },
  (t) => [uniqueIndex("verification_checks_run_ordinal_key").on(t.runId, t.ordinal)],
);

export type Operator = typeof operators.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Scan = typeof scans.$inferSelect;
export type ScanExecution = typeof scanExecutions.$inferSelect;
export type ExecutionEventRow = typeof executionEvents.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type WorkerInstance = typeof workerInstances.$inferSelect;
export type Journey = typeof journeys.$inferSelect;
export type Dependency = typeof dependencies.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type NetworkRequestRow = typeof networkRequests.$inferSelect;
export type StepResultRow = typeof stepResults.$inferSelect;
export type RegressionTest = typeof regressionTests.$inferSelect;
export type SourceRepository = typeof sourceRepositories.$inferSelect;
export type RepairRequest = typeof repairRequests.$inferSelect;
export type RepairEvent = typeof repairEvents.$inferSelect;
export type VerificationRun = typeof verificationRuns.$inferSelect;
export type VerificationCheck = typeof verificationChecks.$inferSelect;
