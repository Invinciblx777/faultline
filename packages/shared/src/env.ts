import { z } from "zod";
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
});

export const webEnvSchema = coreEnvSchema.extend({
  FAULTLINE_SESSION_TTL_HOURS: intFromEnv(12, 1, 24 * 30),
  /** Defaults to true when NODE_ENV=production. Set false only for plain-http local use. */
  FAULTLINE_COOKIE_SECURE: z.enum(["true", "false", "auto"]).default("auto"),
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
