import { defineConfig, devices } from "@playwright/test";
import { E2E_PARTNER_PORT, E2E_TARGET_PORT, E2E_WEB_PORT, e2eEnv } from "./e2e/env";

/**
 * End-to-end tests against the production build (`pnpm build` first), a real
 * worker, PostgreSQL, MinIO, and the local reference target.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL: `http://localhost:${E2E_WEB_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "mobile-chromium", use: { ...devices["iPhone 15 Pro Max"], browserName: "chromium" }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `node ../../tools/reference-target/server.mjs`,
      env: { PORT: String(E2E_TARGET_PORT), PARTNER_PORT: String(E2E_PARTNER_PORT) },
      url: `http://localhost:${E2E_TARGET_PORT}/`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec next start --port ${E2E_WEB_PORT}`,
      env: e2eEnv() as Record<string, string>,
      url: `http://localhost:${E2E_WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
