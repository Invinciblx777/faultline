import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERNAME } from "./env";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(E2E_USERNAME);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

export async function createProject(page: Page, name: string, origin: string) {
  await page.goto("/projects/new");
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Website origin").fill(origin);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  return page.url();
}
