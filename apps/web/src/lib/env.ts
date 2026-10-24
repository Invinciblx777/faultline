import "server-only";
import { parseEnv, webEnvSchema, type WebEnv } from "@faultline/shared/env";

let cached: WebEnv | null = null;

/** Validated server configuration. Throws a ConfigError listing every problem. */
export function getEnv(): WebEnv {
  cached ??= parseEnv(webEnvSchema);
  return cached;
}

export function cookieSecure(): boolean {
  const setting = getEnv().FAULTLINE_COOKIE_SECURE;
  if (setting === "auto") return process.env.NODE_ENV === "production";
  return setting === "true";
}
