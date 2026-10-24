// Captures the documentation screenshots of the screens restyled in Phase 4.6 from a live server.
// Run `pnpm test:visual` first (it signs in and records targets).
//
//   node tests/visual/capture-docs.mjs <out-dir>   (FAULTLINE_VISUAL_URL defaults to http://localhost:3000)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const baseURL = process.env.FAULTLINE_VISUAL_URL ?? "http://localhost:3000";
const out = process.argv[2];
if (!out) throw new Error("usage: capture-docs.mjs <out-dir>");
const dir = new URL("../../test-results/visual/", import.meta.url);
const t = JSON.parse(readFileSync(new URL("targets.json", dir), "utf8"));
const shots = [
  { file: "01-blast-radius-map.png", path: t.blastRadius },
  { file: "10-blast-radius-mobile.png", path: t.blastRadius, mobile: true },
  { file: "11-new-scan-form.png", path: t.extra.newScan },
  { file: "12-new-analysis-form.png", path: t.extra.newAnalysis },
  { file: "13-journey-builder.png", path: t.journeyBuilder },
  { file: "14-settings.png", path: t.extra.settings },
  { file: "15-scan-detail.png", path: t.scanDetail },
  { file: "16-scan-report.png", path: t.extra.report },
  ...(t.extra.realAppBlastRadius ? [{ file: "real-app/01-blast-radius-map.png", path: t.extra.realAppBlastRadius }] : []),
];

mkdirSync(`${out}/real-app`, { recursive: true });
const browser = await chromium.launch();
for (const shot of shots) {
  const context = await browser.newContext({
    baseURL,
    storageState: new URL("state.json", dir).pathname,
    viewport: shot.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: Boolean(shot.mobile),
    hasTouch: Boolean(shot.mobile),
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await context.addCookies([{ name: "faultline_theme", value: "dark", url: baseURL }]);
  const page = await context.newPage();
  await page.goto(shot.path);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${out}/${shot.file}`, animations: "disabled" });
  console.log(`${shot.file}  ${shot.path}`);
  await context.close();
}
await browser.close();
