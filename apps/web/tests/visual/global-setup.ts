import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type FullConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { createDatabase, journeys, repairRequests, scans } from "@faultline/db";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const out = fileURLToPath(new URL("../../test-results/visual/", import.meta.url));
export const USERNAME = "visual-snapshots";

/**
 * Signs in a dedicated local operator and records which stored records each screen shows. The
 * password is random per run, set through the operator:create script, and never written to disk.
 */
export default async function globalSetup(config: FullConfig) {
  loadEnv({ path: `${root}.env`, quiet: true });
  const baseURL = config.projects[0]!.use.baseURL!;
  const password = randomBytes(18).toString("base64url");
  const created = spawnSync("pnpm", ["operator:create", USERNAME], { cwd: root, env: { ...process.env, FAULTLINE_OPERATOR_PASSWORD: password }, encoding: "utf8" });
  if (created.status !== 0) throw new Error(`operator:create failed: ${created.stderr || created.stdout}`);

  const handle = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const { db } = handle;
    const [repair] = await db.select().from(repairRequests).where(isNotNull(repairRequests.verdict)).orderBy(desc(repairRequests.verdictAt)).limit(1);
    const [scan] = await db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.status, "completed"), ne(scans.scenarioKind, "blast-radius")))
      .orderBy(desc(scans.finishedAt))
      .limit(1);
    const [journey] = await db.select({ id: journeys.id, projectId: journeys.projectId }).from(journeys).orderBy(desc(journeys.createdAt)).limit(1);
    if (!repair || !scan || !journey) throw new Error("The database has no verified repair, completed scan, or journey to snapshot.");
    mkdirSync(out, { recursive: true });
    writeFileSync(
      `${out}targets.json`,
      JSON.stringify({
        blastRadius: `/scans/${repair.scanId}/blast-radius`,
        realitySplit: `/scans/${repair.scanId}/experiments/${repair.experimentId}`,
        verification: `/repairs/${repair.id}`,
        scanDetail: `/scans/${scan.id}`,
        journeyBuilder: `/projects/${journey.projectId}/journeys/${journey.id}/edit`,
      }),
    );
  } finally {
    await handle.close();
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/login");
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.context().storageState({ path: `${out}state.json` });
  await browser.close();
}
