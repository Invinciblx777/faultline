import { expect, test } from "@playwright/test";
import { E2E_TARGET_ORIGIN } from "./env";
import { createProject, signIn } from "./helpers";

const journey = {
  name: "Buy a backpack",
  steps: [
    { type: "navigate", path: "/shop/" },
    { type: "assertVisible", target: { by: "text", text: "Trail Backpack" } },
    { type: "click", target: { by: "role", role: "button", name: "Add Trail Backpack to cart" } },
    { type: "assertText", target: { by: "testId", testId: "cart-count" }, text: "1 item" },
    { type: "fill", target: { by: "label", label: "ZIP code" }, value: "94107" },
    { type: "click", target: { by: "role", role: "button", name: "Get shipping quote" } },
    { type: "assertText", target: { by: "testId", testId: "order-total" }, text: "Total", maxDurationMs: 2000 },
  ],
};

test.describe.serial("Blast Radius against the reference storefront", () => {
  test("journey → analysis → map → evidence → validated regression test", async ({ page }) => {
    await signIn(page);
    const projectUrl = await createProject(page, "Storefront (E2E)", E2E_TARGET_ORIGIN);

    // Create a journey through the JSON editor and save it as version 1.
    await page.goto(`${projectUrl}/journeys/new`);
    await page.getByRole("radio", { name: "JSON" }).click();
    await page.getByLabel("Journey JSON").fill(JSON.stringify(journey));
    await page.getByRole("button", { name: "Apply JSON" }).click();
    await expect(page.getByRole("combobox", { name: "Step 7 type" })).toBeVisible();
    await page.getByRole("button", { name: "Save journey" }).click();
    await expect(page.getByRole("heading", { name: "Buy a backpack" })).toBeVisible();
    await expect(page.getByText("Version 1 (latest)")).toBeVisible();

    // Launch: injected API errors only, three experiments, confirmation on.
    await page.getByRole("link", { name: "Analyze blast radius" }).click();
    await page.getByRole("checkbox", { name: /Dependency unavailable/ }).click();
    await page.getByRole("checkbox", { name: /Slow response/ }).click();
    await page.locator('input[name="maxExperiments"]').fill("3");
    await page.getByRole("button", { name: "Launch analysis" }).click();
    await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}\/blast-radius$/);
    const analysisUrl = page.url();

    // Live progress comes from stored rows; wait for the analysis to finish.
    await expect(page.getByRole("link", { name: "Export JSON" })).toBeVisible({ timeout: 280_000 });
    await expect(page.getByRole("heading", { name: "Blast Radius Map" })).toBeVisible();

    // The inventory API is fetched together with the catalog; an injected 503 breaks the storefront.
    const inventory = page.getByRole("button", { name: /GET \/api\/inventory: BROKEN/ });
    await expect(inventory).toBeVisible();
    // The recommendations widget has a fallback, so its failure is tolerated.
    await expect(page.getByRole("button", { name: /GET \/api\/recommendations: RESILIENT/ })).toBeVisible();

    await inventory.click();
    const drawer = page.getByRole("complementary", { name: "Experiment details" });
    await expect(drawer.getByText(/Reproduced in a second run/)).toBeVisible();
    await drawer.getByRole("link", { name: /Evidence and Reality Split/ }).click();

    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Reality Split" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Screenshot: Baseline (normal)" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Screenshot: Under fault" })).toBeVisible();
    await page.getByRole("radio", { name: "Pixel diff" }).click();
    await expect(page.getByRole("img", { name: /Pixel difference/ })).toBeVisible();
    await expect(page.getByText("Injected 503").first()).toBeVisible();
    await expect(page.getByText(/Storefront failed to load/).first()).toBeVisible();
    await expect(page.getByText("Validated: fails on the current site")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download regression test" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^faultline-get-api-inventory-http-error-[0-9a-f]{8}\.spec\.ts$/);

    // Findings history lists the experiment; the analysis export is real JSON.
    await page.goto("/experiments?verdict=broken");
    await expect(page.getByText(/GET \/api\/inventory/).first()).toBeVisible();
    const res = await page.request.get(`/api/scans/${analysisUrl.split("/scans/")[1]!.split("/")[0]}/report`);
    const report = await res.json();
    expect(report.schema).toBe("faultline.analysis/v1");
    expect(report.experiments.length).toBe(3);
  });

  test("unauthenticated users cannot download regression tests or read analysis status", async ({ request }) => {
    for (const path of ["/api/experiments/00000000-0000-4000-8000-000000000000/regression-test", "/api/scans/00000000-0000-4000-8000-000000000000/analysis"]) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });
});
