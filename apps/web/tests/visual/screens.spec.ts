import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const { extra: _extra, ...targets } = JSON.parse(readFileSync(new URL("../../test-results/visual/targets.json", import.meta.url), "utf8")) as Record<string, string> & { extra: unknown };

const SCREENS: Array<{ name: string; path: string }> = [
  { name: "design", path: "/design" },
  { name: "blast-radius", path: targets.blastRadius! },
  { name: "reality-split", path: targets.realitySplit! },
  { name: "verification", path: targets.verification! },
  { name: "scan-detail", path: targets.scanDetail! },
  { name: "journey-builder", path: targets.journeyBuilder! },
];

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await context.addCookies([{ name: "faultline_theme", value: String(testInfo.project.metadata.theme), url: baseURL! }]);
});

for (const screen of SCREENS) {
  test(screen.name, async ({ page }) => {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle");
    // Relative times ("3 minutes ago") change between runs; they are masked, not frozen.
    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: false, mask: [page.locator("time")] });
  });
}
