#!/usr/bin/env node
// One-command local setup: .env with generated secrets (if missing), PostgreSQL
// and MinIO via Docker Compose or podman-compose, database migrations, and the
// Playwright Chromium download. Safe to run again: each step is idempotent.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: quiet ? "ignore" : "inherit" });
  return result.status === 0;
}

function step(title) {
  console.log(`\n▸ ${title}`);
}

function fail(message) {
  console.error(`\n✘ ${message}`);
  process.exit(1);
}

step("Local configuration");
if (existsSync(join(root, ".env"))) console.log(".env exists; keeping it.");
else if (!run("node", ["scripts/setup-env.mjs"])) fail("Could not write .env.");

step("PostgreSQL and MinIO");
// COMPOSE_PROJECT_NAME lets a second checkout run beside the first one.
const project = process.env.COMPOSE_PROJECT_NAME ? ["-p", process.env.COMPOSE_PROJECT_NAME] : [];
if (run("docker", ["compose", "version"], { quiet: true })) {
  if (!run("docker", ["compose", ...project, "up", "-d"])) fail("docker compose up failed.");
} else if (run("podman-compose", ["--version"], { quiet: true })) {
  if (!run("podman-compose", [...project, "up", "-d"])) fail("podman-compose up failed.");
} else {
  fail("Neither Docker Compose nor podman-compose is installed. Install one, then run pnpm quickstart again.");
}

step("Database schema");
// PostgreSQL needs a few seconds after its container starts.
let migrated = false;
for (let attempt = 1; attempt <= 20 && !migrated; attempt++) {
  migrated = run("pnpm", ["-s", "db:migrate"], { quiet: attempt < 20 });
  if (!migrated) await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!migrated) fail("Migrations failed. Is PostgreSQL running? Check the compose logs.");
if (!run("pnpm", ["-s", "db:migrate:test"])) fail("Test database migrations failed.");
console.log("Migrations applied.");

step("Chromium for the worker");
if (!run("pnpm", ["-s", "browsers:install"])) fail("Chromium download failed. On Debian/Ubuntu also run: pnpm --filter @faultline/worker exec playwright install-deps chromium");

console.log(`
✔ Ready. Next:
  pnpm operator:create admin      # choose a password (12+ characters)
  pnpm demo                       # storefront :4600, worker, web app on http://localhost:3000
`);
