import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { parseEnv, workerEnvSchema, type WorkerEnv } from "@faultline/shared/env";
import { createDatabase, type DatabaseHandle } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

/**
 * Integration tests run against DATABASE_URL_TEST and a separate bucket so
 * they never touch operator data. They refuse to run against any database
 * whose name does not end in "_test".
 */
export function testEnv(overrides: Record<string, string> = {}): WorkerEnv {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set; integration tests need a separate test database.");
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("DATABASE_URL_TEST must point at a database whose name ends with _test.");
  return parseEnv(workerEnvSchema, {
    ...process.env,
    DATABASE_URL: url,
    S3_BUCKET: "faultline-test-artifacts",
    FAULTLINE_SETTLE_TIMEOUT_MS: "1500",
    FAULTLINE_NAVIGATION_TIMEOUT_MS: "15000",
    ...overrides,
  });
}

export async function openTestDatabase(env: WorkerEnv): Promise<DatabaseHandle> {
  await runMigrations(env.DATABASE_URL);
  return createDatabase(env.DATABASE_URL, { max: 5, applicationName: "faultline-test" });
}

export async function resetTestDatabase(handle: DatabaseHandle) {
  const [{ name }] = (await handle.db.execute(sql`select current_database() as name`)).rows as [{ name: string }];
  if (!name.endsWith("_test")) throw new Error(`Refusing to truncate non-test database ${name}`);
  await handle.db.execute(
    sql`truncate table execution_events, artifacts, scan_executions, scans, projects, operator_sessions, operators, worker_instances restart identity cascade`,
  );
}
