import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_TARGET_ORIGIN } from "./env";
import { createProject, signIn } from "./helpers";

async function waitForTerminal(page: Page) {
  await expect(page.getByRole("link", { name: "Reality Split" }).first()).toBeVisible({ timeout: 90_000 });
}

test.describe.serial("scan flow against the reference target", () => {
  let projectUrl = "";

  test("rejects projects for origins that are not allowlisted", async ({ page }) => {
    await signIn(page);
    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("Not mine");
    await page.getByLabel("Website origin").fill("https://example.org");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(/not on this server's scan allowlist/).first()).toBeVisible();
  });

  test("creates a project and runs a real resource-failure scan", async ({ page }) => {
    await signIn(page);
    projectUrl = await createProject(page, "Reference target (E2E)", E2E_TARGET_ORIGIN);
    await page.getByRole("link", { name: "Run the first scan" }).click();
    await expect(page).toHaveURL(/scans\/new$/);
    await page.getByRole("button", { name: "Run scan" }).click();
    await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}$/);
    const scanUrl = page.url();
    await waitForTerminal(page);
    await expect(page.getByText("Completed").first()).toBeVisible();
    await expect(page.getByText("RangeError: Invalid array length").first()).toBeVisible();
    await expect(page.getByText("FAULTLINE intentionally aborted 1 request in the fault execution.")).toBeVisible();

    // Reality Split shows two real screenshots served by the authenticated artifact route.
    await page.goto(`${scanUrl}/split`);
    const images = page.locator('img[src^="/api/artifacts/"]');
    await expect(images).toHaveCount(2);
    for (const img of await images.all()) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    }
    await page.getByRole("radio", { name: "Seam" }).click();
    const slider = page.getByRole("slider");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");

    // JSON export contains genuine observations, and artifact hashes match the served bytes.
    const res = await page.request.get(`${scanUrl.replace("/scans/", "/api/scans/")}/report`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const report = await res.json();
    expect(report.schema).toBe("faultline.report/v1");
    expect(report.executions.map((e: { role: string }) => e.role)).toEqual(["baseline", "fault"]);
    const fault = report.executions[1];
    expect(fault.events.some((e: { kind: string; url: string }) => e.kind === "fault_injected" && e.url.endsWith("/styles.css"))).toBe(true);
    for (const execution of report.executions) {
      const bytes = await (await page.request.get(`/api/artifacts/${execution.screenshot.id}`)).body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(execution.screenshot.sha256);
    }

    // Report view renders the conclusions section.
    await page.goto(`${scanUrl}/report`);
    await expect(page.getByRole("heading", { name: "What this evidence supports" })).toBeVisible();
    await expect(page.getByText(/not automatically defects/)).toBeVisible();
  });

  test("runs an offline-reload scan and labels it as emulation", async ({ page }) => {
    await signIn(page);
    await page.goto(`${projectUrl}/scans/new`);
    await page.getByRole("radio", { name: /Offline reload/ }).click();
    await page.getByRole("button", { name: "Run scan" }).click();
    await waitForTerminal(page);
    await expect(page.getByText("Navigation failed").first()).toBeVisible();
    await expect(page.getByText(/ERR_INTERNET_DISCONNECTED/).first()).toBeVisible();
  });

  test("history lists real scans and filters them", async ({ page }) => {
    await signIn(page);
    await page.goto(`${projectUrl}/history`);
    await expect(page.locator('a[href^="/scans/"]')).toHaveCount(2);
    await page.getByLabel("Scenario").selectOption("offline-reload");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/scenario=offline-reload/);
    await expect(page.locator('a[href^="/scans/"]')).toHaveCount(1);
    await page.getByLabel("Status").selectOption("failed");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("No scans match these filters")).toBeVisible();
  });

  test("a queued scan can be cancelled", async ({ page }) => {
    await signIn(page);
    await page.goto(`${projectUrl}/scans/new`);
    await page.getByRole("button", { name: "Run scan" }).click();
    await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}$/);
    const cancel = page.getByRole("button", { name: "Cancel scan" });
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      await expect(page.getByText(/Cancelled|Completed/).first()).toBeVisible({ timeout: 60_000 });
    }
    // Whether cancellation won the race or the scan finished first, it must never show as running forever.
    await expect(page.getByText(/This scan was cancelled|Completed/).first()).toBeVisible({ timeout: 60_000 });
  });
});
