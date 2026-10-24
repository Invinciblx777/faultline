import { defineConfig } from "@playwright/test";

/**
 * Visual regression snapshots of the M3 Expressive screens. Runs against a live FAULTLINE web
 * server (default http://localhost:3000) and its database, so every screen shows stored records,
 * never fixtures. Kept apart from `test:e2e` so a pixel change never blocks the functional gate.
 *
 *   pnpm test:visual                      # compare against committed baselines
 *   pnpm test:visual --update-snapshots   # re-baseline after an intended UI change
 */
const baseURL = process.env.FAULTLINE_VISUAL_URL ?? "http://localhost:3000";
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/visual/global-setup.ts",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  use: { baseURL, reducedMotion: "reduce", storageState: "test-results/visual/state.json", deviceScaleFactor: 1 },
  projects: [
    { name: "desktop-dark", use: { viewport: desktop, colorScheme: "dark" }, metadata: { theme: "dark" } },
    { name: "desktop-light", use: { viewport: desktop, colorScheme: "light" }, metadata: { theme: "light" } },
    { name: "mobile-dark", use: { viewport: mobile, colorScheme: "dark", isMobile: true, hasTouch: true }, metadata: { theme: "dark" } },
    { name: "mobile-light", use: { viewport: mobile, colorScheme: "light", isMobile: true, hasTouch: true }, metadata: { theme: "light" } },
  ],
});
