import { sql } from "drizzle-orm";
import {
  bigint,
  type AnyPgColumn,
  boolean,
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
