import { expect, test } from "@playwright/test";

test.describe("access control", () => {
  test("protected pages redirect to sign-in", async ({ page }) => {
    for (const path of ["/projects", "/scans", "/settings", "/projects/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("APIs refuse unauthenticated requests", async ({ request }) => {
    for (const path of ["/api/scans/00000000-0000-4000-8000-000000000000", "/api/scans/00000000-0000-4000-8000-000000000000/report", "/api/artifacts/00000000-0000-4000-8000-000000000000"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });

  test("a forged session cookie passes the optimistic gate but is rejected by session validation", async ({ page }) => {
    await page.setExtraHTTPHeaders({ cookie: "__Host-faultline_session=forged-token-value" });
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong credentials show an error and do not sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("e2e-operator");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Username or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
