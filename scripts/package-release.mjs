#!/usr/bin/env node
// Builds prebuilt release bundles into release/:
//   faultline-<version>-linux-x64.tar.gz
//   faultline-<version>-windows-x64.zip
//   SHA256SUMS
// Each bundle holds the standalone web server, the bundled worker with its production
// dependencies, migration and operator tools, and a launcher (faultline.sh / faultline.cmd).
// PostgreSQL, MinIO and Node.js 22.12+ stay external.
//
// Run on Linux from a clean checkout:  node scripts/package-release.mjs
// It deletes and reinstalls every node_modules hoisted, so no bundle contains symlinked packages
// (Windows zips cannot carry them). pnpm deploy then prunes the checkout to the worker's
// production dependencies; run `pnpm install` afterwards to develop in it again.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(root, "release");
const work = join(out, ".work");

// pnpm reinstalls before running scripts when it thinks node_modules is stale; keep every
// pnpm invocation on the hoisted linker so it never switches back to isolated symlinks.
const pnpmEnv = { ...process.env, pnpm_config_node_linker: "hoisted" };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: pnpmEnv, ...options });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed.`);
}

function step(title) {
  console.log(`\n▸ ${title}`);
}

function fail(message) {
  console.error(`\n✘ ${message}`);
  process.exit(1);
}

if (process.platform !== "linux") fail("Package releases on Linux; the Windows bundle is assembled from the Linux build.");
// next.config loads the root .env into the build environment; release builds never see local secrets.
if (existsSync(join(root, ".env"))) fail("A root .env exists. Package from a clean checkout without local secrets.");
rmSync(out, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

step("Dependencies (hoisted)");
// Switching linkers leaves stale .bin shims behind, so start from empty node_modules.
for (const dir of ["", "apps", "packages", "tools"]) {
  const parents = dir ? readdirSync(join(root, dir)).map((name) => join(dir, name)) : [""];
  for (const parent of parents) rmSync(join(root, parent, "node_modules"), { recursive: true, force: true });
}
run("pnpm", ["install", "--frozen-lockfile"]);
if (!/"nodeLinker": "hoisted"/.test(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"))) fail("node_modules is not hoisted.");
// esbuild is a worker devDependency; resolve the worker's pinned copy.
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/worker/package.json")).resolve("esbuild")).href);

step("Worker bundle");
run("pnpm", ["--filter", "@faultline/worker", "build"]);

step("Standalone web server");
const webDist = ".next-release";
run("pnpm", ["--filter", "@faultline/web", "build"], {
  env: { ...pnpmEnv, NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: webDist, NEXT_TELEMETRY_DISABLED: "1" },
});

step("Database tools");
// The bundle's launcher passes --env-file, so the repository-relative .env loader is stubbed out.
const stubRootEnv = {
  name: "stub-root-env",
  setup(b) {
    b.onResolve({ filter: /^\.\/env$/ }, () => ({ path: "env", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export function loadRootEnv() {}", loader: "js" }));
  },
};
for (const name of ["migrate", "create-operator"]) {
  await build({
    entryPoints: [join(root, `packages/db/scripts/${name}.ts`)],
    outfile: join(work, "tools", `${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["pg-native", "cloudflare:sockets"],
    plugins: [stubRootEnv],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
}

step("Worker production dependencies");
run("pnpm", ["--filter", "@faultline/worker", "deploy", "--prod", "--legacy", join(work, "worker")]);

step("Assemble");
const linuxName = `faultline-${version}-linux-x64`;
const windowsName = `faultline-${version}-windows-x64`;
const linux = join(out, linuxName);
const standalone = join(root, "apps/web", webDist, "standalone");
// Traced output links externals (pg, pg-boss, client-s3) by absolute symlink; bundles carry
// real files. GNU cp -L, because fs.cpSync dereferences only the top-level path.
mkdirSync(join(linux, "worker"), { recursive: true });
run("cp", ["-rL", standalone, join(linux, "web")]);
cpSync(join(root, "apps/web", webDist, "static"), join(linux, "web/apps/web", webDist, "static"), { recursive: true });
if (existsSync(join(root, "apps/web/public"))) cpSync(join(root, "apps/web/public"), join(linux, "web/apps/web/public"), { recursive: true });
for (const entry of ["dist", "package.json", "node_modules"]) run("cp", ["-rL", join(work, "worker", entry), join(linux, "worker", entry)]);
// Workspace packages are already inlined into dist/main.js; their sources and tests stay out.
for (const dir of [".bin", "@faultline"]) rmSync(join(linux, "worker/node_modules", dir), { recursive: true, force: true });
cpSync(join(work, "tools"), join(linux, "tools"), { recursive: true });
cpSync(join(root, "packages/db/migrations"), join(linux, "migrations"), { recursive: true });
cpSync(join(root, "infra/postgres/init"), join(linux, "infra/postgres/init"), { recursive: true });
for (const file of ["docker-compose.yml", ".env.example", "LICENSE"]) cpSync(join(root, file), join(linux, file));
cpSync(join(root, "scripts/setup-env.mjs"), join(linux, "scripts/setup-env.mjs"));
writeFileSync(join(linux, "INSTALL.md"), install(version));
writeFileSync(join(linux, "faultline.sh"), launcherSh(), { mode: 0o755 });

const windows = join(out, windowsName);
cpSync(linux, windows, { recursive: true });
rmSync(join(windows, "faultline.sh"));
writeFileSync(join(windows, "faultline.cmd"), launcherCmd().replaceAll("\n", "\r\n"));
swapSharpForWindows(join(windows, "web/node_modules"));

step("Archives");
run("tar", ["-czf", `${linuxName}.tar.gz`, linuxName], { cwd: out });
run("zip", ["-qrX", `${windowsName}.zip`, windowsName], { cwd: out });
const sums = [`${linuxName}.tar.gz`, `${windowsName}.zip`]
  .map((file) => `${createHash("sha256").update(readFileSync(join(out, file))).digest("hex")}  ${file}`)
  .join("\n");
writeFileSync(join(out, "SHA256SUMS"), `${sums}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`\n✔ ${out}\n${sums}\n\nnode_modules now holds only worker production dependencies; run pnpm install to develop here.`);

/** Replaces sharp's Linux binaries with the win32-x64 package, checked against the lockfile integrity. */
function swapSharpForWindows(nodeModules) {
  const img = join(nodeModules, "@img");
  for (const entry of readdirSync(img)) if (/^sharp-(libvips-)?linux/.test(entry)) rmSync(join(img, entry), { recursive: true });
  const sharpPackage = join(nodeModules, "sharp/package.json");
  if (!existsSync(sharpPackage)) fail("sharp is not in the standalone output.");
  const sharpVersion = JSON.parse(readFileSync(sharpPackage, "utf8")).version;
  const spec = `@img/sharp-win32-x64@${sharpVersion}`;
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const integrity = lock.match(new RegExp(`'${spec.replace(/[.+]/g, "\\$&")}':\\s*\\n\\s*resolution: \\{integrity: (sha512-[^}\\s]+)\\}`))?.[1];
  if (!integrity) fail(`${spec} is not in pnpm-lock.yaml.`);
  const packDir = join(work, "sharp-win32");
  mkdirSync(packDir, { recursive: true });
  run("npm", ["pack", spec, "--pack-destination", packDir, "--silent"]);
  const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")));
  const actual = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  if (actual !== integrity) fail(`${spec} integrity mismatch: lockfile ${integrity}, download ${actual}.`);
  const target = join(nodeModules, "@img/sharp-win32-x64");
  mkdirSync(target, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"]);
  console.log(`${spec} installed (integrity matches lockfile).`);
}

function launcherSh() {
  return `#!/usr/bin/env bash
# FAULTLINE launcher. ./faultline.sh help
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ENV_ARG="--env-file-if-exists=$ROOT/.env"
WEB="$ROOT/web/apps/web/server.js"
cmd="\${1:-help}"
shift || true

web() {
  # Next standalone binds to $HOSTNAME; shells often set it to the machine name.
  HOSTNAME="\${FAULTLINE_WEB_HOST:-127.0.0.1}" PORT="\${FAULTLINE_WEB_PORT:-3000}" node "$ENV_ARG" "$WEB"
}

case "$cmd" in
  setup) node "$ROOT/scripts/setup-env.mjs" ;;
  infra)
    cd "$ROOT"
    if docker compose version >/dev/null 2>&1; then docker compose up -d; else podman-compose up -d; fi ;;
  migrate) node "$ENV_ARG" "$ROOT/tools/migrate.mjs" "$@" ;;
  operator) node "$ENV_ARG" "$ROOT/tools/create-operator.mjs" "$@" ;;
  browsers) node "$ROOT/worker/node_modules/playwright/cli.js" install chromium ;;
  web) web ;;
  worker) node "$ENV_ARG" "$ROOT/worker/dist/main.js" ;;
  start)
    node "$ENV_ARG" "$ROOT/worker/dist/main.js" &
    WORKER_PID=$!
    trap 'kill "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM
    web ;;
  *)
    cat <<'HELP'
Usage: ./faultline.sh <command>
  setup            write .env with generated local secrets
  infra            start PostgreSQL and MinIO (docker compose or podman-compose)
  migrate          apply database migrations (--test for DATABASE_URL_TEST)
  operator <name>  create an operator account or reset its password
  browsers         download Playwright Chromium for the worker
  start            run the worker and the web app (http://127.0.0.1:3000)
  web | worker     run one process
HELP
    ;;
esac
`;
}

function launcherCmd() {
  return `@echo off
rem FAULTLINE launcher. faultline.cmd help
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "ENV_ARG=--env-file-if-exists=%ROOT%\\.env"
set "CMD=%~1"
if "%FAULTLINE_WEB_HOST%"=="" set "FAULTLINE_WEB_HOST=127.0.0.1"
if "%FAULTLINE_WEB_PORT%"=="" set "FAULTLINE_WEB_PORT=3000"

if /i "%CMD%"=="setup" ( node "%ROOT%\\scripts\\setup-env.mjs" & goto :eof )
if /i "%CMD%"=="infra" goto infra
if /i "%CMD%"=="migrate" ( node "%ENV_ARG%" "%ROOT%\\tools\\migrate.mjs" %2 & goto :eof )
if /i "%CMD%"=="operator" ( node "%ENV_ARG%" "%ROOT%\\tools\\create-operator.mjs" %2 & goto :eof )
if /i "%CMD%"=="browsers" ( node "%ROOT%\\worker\\node_modules\\playwright\\cli.js" install chromium & goto :eof )
if /i "%CMD%"=="web" goto web
if /i "%CMD%"=="worker" ( node "%ENV_ARG%" "%ROOT%\\worker\\dist\\main.js" & goto :eof )
if /i "%CMD%"=="start" (
  start "FAULTLINE worker" node "%ENV_ARG%" "%ROOT%\\worker\\dist\\main.js"
  goto web
)
echo Usage: faultline.cmd ^<command^>
echo   setup            write .env with generated local secrets
echo   infra            start PostgreSQL and MinIO (docker compose or podman-compose)
echo   migrate          apply database migrations (--test for DATABASE_URL_TEST)
echo   operator ^<name^>  create an operator account or reset its password
echo   browsers         download Playwright Chromium for the worker
echo   start            run the worker (new window) and the web app (http://127.0.0.1:3000)
echo   web ^| worker     run one process
goto :eof

:infra
pushd "%ROOT%"
docker compose version >nul 2>&1 && ( docker compose up -d ) || ( podman-compose up -d )
popd
goto :eof

:web
set "HOSTNAME=%FAULTLINE_WEB_HOST%"
set "PORT=%FAULTLINE_WEB_PORT%"
node "%ENV_ARG%" "%ROOT%\\web\\apps\\web\\server.js"
goto :eof
`;
}

function install(v) {
  return `# FAULTLINE ${v}

Break it. Understand it. Fix it. Prove it.

Prebuilt bundle: standalone web app, scan worker, database tools. Commands below use
\`./faultline.sh\` (Linux). On Windows use \`faultline.cmd\` with the same commands.

## Requirements
- Node.js 22.12 or newer
- Docker Compose or podman-compose (PostgreSQL 17 and MinIO), or your own PostgreSQL and S3-compatible storage
- Podman and git on PATH for candidate verification of repair commits (optional)

## First run
\`\`\`
./faultline.sh setup           # .env with generated local secrets
./faultline.sh infra           # PostgreSQL + MinIO on 127.0.0.1
./faultline.sh migrate         # schema
./faultline.sh browsers        # Playwright Chromium
./faultline.sh operator admin  # choose a password (12+ characters)
./faultline.sh start           # http://127.0.0.1:3000
\`\`\`
Edit \`.env\` to set \`FAULTLINE_SCAN_ALLOWLIST\` to origins you are authorized to test.
Devin repair stays disabled until \`DEVIN_API_KEY\`, \`DEVIN_ORG_ID\` and \`FAULTLINE_REPAIR_APPROVERS\` are set.

\`FAULTLINE_WEB_HOST\` / \`FAULTLINE_WEB_PORT\` change the web bind address (default 127.0.0.1:3000).
On Debian/Ubuntu, Chromium may also need: \`node worker/node_modules/playwright/cli.js install-deps chromium\`.

## Verify the download
\`sha256sum -c SHA256SUMS\` (Linux) or \`Get-FileHash <file> -Algorithm SHA256\` (PowerShell).
`;
}
