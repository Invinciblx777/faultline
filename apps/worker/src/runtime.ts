import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import type { LaunchOptions } from "playwright";
import { FAULTLINE_VERSION } from "@faultline/shared";
import type { WorkerEnv } from "@faultline/shared/env";

export interface RuntimeInfo {
  workerId: string;
  workerVersion: string;
  playwrightVersion: string;
  hostname: string;
  browserVersion: string | null;
}

export function playwrightVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("playwright/package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
}

export function createRuntimeInfo(): RuntimeInfo {
  const host = hostname();
  return {
    workerId: `${host.slice(0, 40)}-${randomBytes(4).toString("hex")}`,
    workerVersion: FAULTLINE_VERSION,
    playwrightVersion: playwrightVersion(),
    hostname: host,
    browserVersion: null,
  };
}

export function browserLaunchOptions(env: WorkerEnv): LaunchOptions {
  return {
    headless: true,
    chromiumSandbox: env.FAULTLINE_CHROMIUM_SANDBOX,
    args: [
      // Keep WebRTC from opening UDP paths that bypass the egress guard proxy.
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-dev-shm-usage",
    ],
    timeout: 30_000,
  };
}
