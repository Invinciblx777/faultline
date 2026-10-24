import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export const E2E_WEB_PORT = 3100;
export const E2E_TARGET_PORT = 4610;
export const E2E_TARGET_ORIGIN = `http://localhost:${E2E_TARGET_PORT}`;
/** The reference target's simulated third-party partner. */
export const E2E_PARTNER_PORT = 4611;
export const E2E_PARTNER_ORIGIN = `http://localhost:${E2E_PARTNER_PORT}`;
export const E2E_USERNAME = "e2e-operator";
export const E2E_PASSWORD = "e2e-password-not-for-production";

/**
 * Environment for the E2E stack. It uses the separate *_test database and a
 * separate bucket, so end-to-end runs never touch operator records.
 */
export function e2eEnv(): Record<string, string> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a *_test database");
  return {
    ...(process.env as Record<string, string>),
    DATABASE_URL: url,
    S3_BUCKET: "faultline-e2e-artifacts",
    FAULTLINE_SCAN_ALLOWLIST: `${E2E_TARGET_ORIGIN},${E2E_PARTNER_ORIGIN}`,
    FAULTLINE_DEPLOYMENT_MODE: "local",
    FAULTLINE_SETTLE_TIMEOUT_MS: "1500",
    FAULTLINE_WORKER_CONCURRENCY: "2",
    NODE_ENV: "production",
  };
}
