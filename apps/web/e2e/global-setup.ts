import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase, operators } from "@faultline/db";
import { runMigrations } from "@faultline/db/migrate";
import { hashPassword } from "@faultline/shared/password";
import { E2E_PASSWORD, E2E_USERNAME, e2eEnv } from "./env";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const PID_FILE = fileURLToPath(new URL("../test-results/.e2e-worker.pid", import.meta.url));

export default async function globalSetup() {
  const env = e2eEnv();
  await runMigrations(env.DATABASE_URL!);
  const handle = createDatabase(env.DATABASE_URL!, { max: 1 });
  try {
    await handle.db.execute(
      sql`truncate table execution_events, artifacts, scan_executions, scans, projects, operator_sessions, operators, worker_instances restart identity cascade`,
    );
    await handle.db.insert(operators).values({ username: E2E_USERNAME, passwordHash: await hashPassword(E2E_PASSWORD) });
  } finally {
    await handle.close();
  }

  // Start a real worker against the test database.
  const worker = spawn("pnpm", ["--filter", "@faultline/worker", "exec", "tsx", "src/main.ts"], { cwd: root, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker did not become ready")), 60_000);
    worker.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes('"worker ready"')) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[worker] ${chunk}`));
    worker.on("exit", (code) => reject(new Error(`worker exited with ${code}`)));
  });
  worker.stdout.removeAllListeners("data");
  worker.stdout.resume();
  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, String(worker.pid));
}
