import { z } from "zod";
import { parseRepositoryAllowlist } from "./repair";
import { parseAllowlist, type AllowlistEntry } from "./url";

/**
 * Server-side configuration, validated at startup by the web app and worker.
 * Never import this module from client components.
 */

const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no", ""])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return defaultValue;
      return value === "true" || value === "1" || value === "yes";
    });

const intFromEnv = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === "") return defaultValue;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({ code: "custom", message: `must be an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return parsed;
    });

const allowlistFromEnv = z
  .string()
  .optional()
  .transform((value, ctx): AllowlistEntry[] => {
    try {
      return parseAllowlist(value ?? "");
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });

const repositoryAllowlistFromEnv = z
  .string()
  .optional()
  .transform((value, ctx): string[] => {
    try {
      return parseRepositoryAllowlist(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const coreEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").url(),
  FAULTLINE_DEPLOYMENT_MODE: z.enum(["local", "public"]).default("local"),
  FAULTLINE_SCAN_ALLOWLIST: allowlistFromEnv,
  FAULTLINE_SUBRESOURCE_POLICY: z.enum(["public", "allowlist"]).default("public"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("faultline-artifacts"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_FORCE_PATH_STYLE: booleanFromEnv(true),
  // --- Verified Repair (optional). Without these FAULTLINE works and labels repair unavailable. ---
  /** Devin API v3 service-user key (cog_…). Server-side only. */
  DEVIN_API_KEY: optionalSecret,
  /** Devin organization ID (org-…). */
  DEVIN_ORG_ID: optionalSecret,
  DEVIN_API_BASE_URL: optionalSecret,
  /** GitHub token with read access to linked repositories (pull requests, contents). Server-side only. */
  GITHUB_TOKEN: optionalSecret,
  /** owner/name repositories operators may link for repair. Empty means none. */
  FAULTLINE_REPAIR_REPOSITORIES: repositoryAllowlistFromEnv,
});

export const workerEnvSchema = coreEnvSchema.extend({
  FAULTLINE_WORKER_CONCURRENCY: intFromEnv(1, 1, 8),
  FAULTLINE_NAVIGATION_TIMEOUT_MS: intFromEnv(30_000, 1_000, 120_000),
  FAULTLINE_SETTLE_TIMEOUT_MS: intFromEnv(5_000, 0, 30_000),
  FAULTLINE_SCENARIO_TIMEOUT_MS: intFromEnv(120_000, 5_000, 600_000),
  FAULTLINE_MAX_REDIRECTS: intFromEnv(10, 0, 20),
  FAULTLINE_MAX_REQUESTS: intFromEnv(1500, 10, 20_000),
  FAULTLINE_MAX_TRANSFER_BYTES: intFromEnv(100 * 1024 * 1024, 1024 * 1024, 2 * 1024 * 1024 * 1024),
  FAULTLINE_MAX_SCREENSHOT_HEIGHT: intFromEnv(6000, 600, 16_000),
  FAULTLINE_CHROMIUM_SANDBOX: booleanFromEnv(true),
  /** Required in public mode: the operator confirms OS/network-level egress isolation for the worker. */
  FAULTLINE_NETWORK_ISOLATION_ACK: booleanFromEnv(false),
  /** Wall-clock budget for one Blast Radius analysis. Must stay below the job expiry (60 min). */
  FAULTLINE_ANALYSIS_TIMEOUT_MS: intFromEnv(30 * 60_000, 60_000, 55 * 60_000),
  /** Execute generated regression tests with Playwright Test against the target after an analysis. */
  FAULTLINE_REGRESSION_VALIDATION: booleanFromEnv(true),
  /** How often active Devin sessions are polled. */
  FAULTLINE_DEVIN_POLL_INTERVAL_MS: intFromEnv(20_000, 5_000, 600_000),
  /** Optional per-session ACU cap passed to Devin as max_acu_limit. */
  DEVIN_MAX_ACU_LIMIT: intFromEnv(0, 0, 1000),
  /** Upload the baseline and under-fault screenshots to Devin as session attachments. */
  FAULTLINE_DEVIN_ATTACH_SCREENSHOTS: booleanFromEnv(true),
  /** Container runtime used to run candidate builds in isolation. */
  FAULTLINE_CONTAINER_RUNTIME: z.enum(["podman", "docker"]).default("podman"),
  /** Image for node-server candidates, pinned by digest. */
  FAULTLINE_VERIFY_IMAGE: z
    .string()
    .regex(/^[a-z0-9./_-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/, "must be an image reference pinned by digest (name@sha256:…)")
    .default("docker.io/library/node@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284"),
  /** Internal (no egress) container network for candidates. Created if missing. */
  FAULTLINE_VERIFY_NETWORK: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,60}$/).default("faultline-verify"),
  /** First loopback port for candidate containers; extra ports follow it. Must be on FAULTLINE_SCAN_ALLOWLIST. */
  FAULTLINE_VERIFY_BASE_PORT: intFromEnv(4700, 1024, 65000),
});

export const webEnvSchema = coreEnvSchema.extend({
  FAULTLINE_SESSION_TTL_HOURS: intFromEnv(12, 1, 24 * 30),
  /** Defaults to true when NODE_ENV=production. Set false only for plain-http local use. */
  FAULTLINE_COOKIE_SECURE: z.enum(["true", "false", "auto"]).default("auto"),
  /** Blast Radius analyses that may be queued or running at once, across all projects. */
  FAULTLINE_MAX_ACTIVE_ANALYSES: intFromEnv(2, 1, 20),
  /** Operator usernames allowed to approve sending a finding to Devin. Empty means nobody can. */
  FAULTLINE_REPAIR_APPROVERS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid FAULTLINE configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function parseEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined> = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`));
  }
  return result.data;
}
