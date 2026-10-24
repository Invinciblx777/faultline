import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("mobile layout uses bottom navigation without horizontal overflow", async ({ page }) => {
  await signIn(page);
  for (const path of ["/projects", "/scans", "/settings"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
