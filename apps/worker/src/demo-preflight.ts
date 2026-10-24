/**
 * One-screen readiness check before a live demo:
 *
 *   pnpm demo:preflight
 *
 * Checks PostgreSQL, MinIO, a live worker heartbeat, the container runtime,
 * a Chromium launch, the web app, the reference storefront, GitHub, and
 * Devin (GET /v3/self only: no session, no credits). Then prints the demo
 * URLs from stored records. Exits 1 if any check fails.
 */
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { chromium } from "playwright";
import { createDatabase, projects, repairRequests, scans, storageConfigFromEnv, workerInstances } from "@faultline/db";
import { parseEnv, workerEnvSchema } from "@faultline/shared/env";
import { DevinClient, devinConfigFromEnv, GitHubClient } from "@faultline/shared/integrations";
import { runtimeAvailable } from "./repair/candidate";
import { browserLaunchOptions } from "./runtime";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

type Result = { name: string; ok: boolean; detail: string };

async function check(name: string, run: () => Promise<string>): Promise<Result> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function httpOk(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
}

const env = parseEnv(workerEnvSchema);
const webUrl = (process.env.FAULTLINE_WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const { db, pool } = createDatabase(env.DATABASE_URL, { max: 2, applicationName: "faultline-preflight" });

const results: Result[] = [];
results.push(
  await check("PostgreSQL", async () => {
    const { rows } = await pool.query<{ v: string }>("select current_setting('server_version') as v");
    return `connected, server ${rows[0]?.v}`;
  }),
);
results.push(
  await check("MinIO artifact storage", async () => {
    const config = storageConfigFromEnv(env);
    const s3 = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
    await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return `bucket ${config.bucket} reachable`;
  }),
);
results.push(
  await check("Worker heartbeat", async () => {
    const [worker] = await db
      .select()
      .from(workerInstances)
      .where(and(isNull(workerInstances.stoppedAt), gt(workerInstances.lastHeartbeatAt, sql`now() - interval '30 seconds'`)))
      .orderBy(desc(workerInstances.lastHeartbeatAt))
      .limit(1);
    if (!worker) throw new Error("No worker heartbeat in the last 30 s. Start it: pnpm worker:restart");
    return `${worker.id}, Chromium ${worker.browserVersion ?? "unknown"}`;
  }),
);
results.push(
  await check("Container runtime", async () => {
    const runtime = await runtimeAvailable({ runtime: env.FAULTLINE_CONTAINER_RUNTIME });
    if (!runtime.ok) throw new Error(runtime.reason);
    return runtime.version;
  }),
);
results.push(
  await check("Chromium launch", async () => {
    const browser = await chromium.launch(browserLaunchOptions(env));
    const version = browser.version();
    await browser.close();
    return `Chromium ${version}, sandbox ${env.FAULTLINE_CHROMIUM_SANDBOX ? "on" : "off"}`;
  }),
);
results.push(
  await check("Web app", async () => {
    const body = (await (await httpOk(`${webUrl}/api/health`)).json()) as { ok?: boolean };
    if (body.ok !== true) throw new Error("/api/health did not return ok");
    return `${webUrl} healthy`;
  }),
);
results.push(
  await check("Reference storefront", async () => {
    await httpOk("http://localhost:4600/shop/");
    return "http://localhost:4600/shop/ serves";
  }),
);
results.push(
  await check("GitHub API", async () => {
    const github = new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim() || null });
    if (!github.hasToken) throw new Error("GITHUB_TOKEN is not set. Run with GITHUB_TOKEN=$(gh auth token)");
    const repos = env.FAULTLINE_REPAIR_REPOSITORIES;
    for (const full of repos) {
      const [owner, name] = full.split("/");
      await github.getRepository(owner!, name!);
    }
    return repos.length ? `token reads ${repos.join(", ")}` : "token set; no repair repositories configured";
  }),
);
results.push(
  await check("Devin API v3", async () => {
    const config = devinConfigFromEnv(process.env);
    if (!config.configured) throw new Error(config.reason);
    const self = await new DevinClient({ apiKey: config.apiKey, orgId: config.orgId, baseUrl: config.baseUrl }).self();
    if (self.org_id && self.org_id !== config.orgId) throw new Error(`The key belongs to ${self.org_id}, not DEVIN_ORG_ID.`);
    return `GET /v3/self ok (${self.principal_type}); no session created`;
  }),
);

const width = Math.max(...results.map((r) => r.name.length));
console.log("\nFAULTLINE demo preflight\n");
for (const r of results) console.log(`${r.ok ? `${GREEN}PASS` : `${RED}FAIL`}${RESET}  ${r.name.padEnd(width)}  ${DIM}${r.detail}${RESET}`);

// Demo URLs come from stored records, never from constants.
try {
  const [repair] = await db
    .select()
    .from(repairRequests)
    .where(isNotNull(repairRequests.verdict))
    .orderBy(desc(repairRequests.verdictAt))
    .limit(1);
  const [realApp] = await db
    .select({ scanId: scans.id, name: projects.name })
    .from(scans)
    .innerJoin(projects, eq(projects.id, scans.projectId))
    .where(and(eq(scans.status, "completed"), isNotNull(scans.journeyId), ne(projects.origin, "http://localhost:4600")))
    .orderBy(desc(scans.finishedAt))
    .limit(1);
  console.log("\nDemo URLs\n");
  console.log(`  Storefront           http://localhost:4600/shop/`);
  if (repair) {
    console.log(`  Blast Radius         ${webUrl}/scans/${repair.scanId}/blast-radius`);
    console.log(`  Finding              ${webUrl}/scans/${repair.scanId}/experiments/${repair.experimentId}`);
    console.log(`  Repair and verdict   ${webUrl}/repairs/${repair.id}`);
    if (repair.devinSessionUrl) console.log(`  Devin session        ${repair.devinSessionUrl}`);
    if (repair.prUrl) console.log(`  Pull request         ${repair.prUrl}/files`);
    if (repair.verdictCommentUrl) console.log(`  Verdict on the PR    ${repair.verdictCommentUrl}`);
  }
  if (realApp) console.log(`  Real-app scan        ${webUrl}/scans/${realApp.scanId}/blast-radius  ${DIM}(${realApp.name})${RESET}`);
} catch (error) {
  console.log(`\n${RED}Could not read demo URLs: ${error instanceof Error ? error.message : String(error)}${RESET}`);
}

await pool.end();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${RED}${failed} check(s) failed. Fix them before presenting.${RESET}\n` : `\n${GREEN}All ${results.length} checks passed.${RESET}\n`);
process.exit(failed ? 1 : 0);
