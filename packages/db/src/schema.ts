import { sql } from "drizzle-orm";
import {
  bigint,
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
  EvidenceKind,
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
  (t) => [uniqueIndex("scan_executions_scan_role_key").on(t.scanId, t.role)],
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
    kind: text("kind").$type<"screenshot">().notNull(),
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
