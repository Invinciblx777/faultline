import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import type { CandidateRecipe } from "@faultline/shared";
import { sha256Hex } from "@faultline/shared/checksum";
import type { GitHubClient } from "@faultline/shared/integrations";

/**
 * Builds and runs one exact commit of a linked repository in isolation:
 *
 * 1. Downloads GitHub's source archive for the full commit SHA (never a branch name).
 * 2. Checks every archive member stays inside one top-level directory named for that commit.
 * 3. Runs the recipe's `node <entry>` in a container: internal network (no internet,
 *    no host access), read-only root and source mount, all capabilities dropped,
 *    no-new-privileges, unprivileged user, memory/CPU/PID limits, and ports published
 *    on 127.0.0.1 only. No dependency installation and no shell commands run.
 *
 * The container carries the commit SHA as a label; FAULTLINE reads it back to tie
 * the running server to the revision it is testing.
 */

const run = promisify(execFile);

export class CandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateError";
  }
}

export interface CandidateSettings {
  runtime: "podman" | "docker";
  image: string;
  network: string;
  basePort: number;
  workRoot: string;
  maxArchiveBytes: number;
  startTimeoutMs: number;
}

export interface CandidateSpec {
  runId: string;
  label: "original" | "candidate";
  owner: string;
  name: string;
  sha: string;
  appDir: string | null;
  recipe: CandidateRecipe;
}

export interface RunningCandidate {
  label: "original" | "candidate";
  sha: string;
  origin: string;
  extraOrigins: string[];
  archiveSha256: string;
  archiveBytes: number;
  archiveRoot: string;
  containerName: string;
  containerId: string;
  image: string;
  imageId: string;
  /** Facts that tie the running server to the commit, in plain language. */
  identity: string[];
  stop: () => Promise<void>;
}

export const LABEL_RUN = "faultline.verification";
export const LABEL_REVISION = "faultline.revision";

async function exec(runtime: string, args: string[], timeoutMs = 60_000): Promise<string> {
  try {
    const { stdout } = await run(runtime, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new CandidateError(`${runtime} ${args[0]} failed: ${(stderr || (error as Error).message).split("\n").slice(-3).join(" ").slice(0, 500)}`);
  }
}

export async function runtimeAvailable(settings: Pick<CandidateSettings, "runtime">): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  try {
    return { ok: true, version: await exec(settings.runtime, ["--version"], 10_000) };
  } catch (error) {
    return { ok: false, reason: `The container runtime "${settings.runtime}" is not available: ${(error as Error).message}` };
  }
}

/** Creates the internal (no egress) network once. */
async function ensureNetwork(settings: CandidateSettings) {
  const exists = await run(settings.runtime, ["network", "inspect", settings.network], { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!exists) await exec(settings.runtime, ["network", "create", "--internal", settings.network]);
  const internal = await exec(settings.runtime, ["network", "inspect", settings.network, "--format", "{{.Internal}}"]);
  if (internal !== "true") throw new CandidateError(`The network ${settings.network} exists but is not internal; refusing to run candidates on a network with egress.`);
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port, timeout: 1000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForHttp(origin: string, timeoutMs: number, isRunning: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000), redirect: "manual" });
      await response.body?.cancel().catch(() => undefined);
      return;
    } catch (error) {
      last = (error as Error).message;
    }
    if (!(await isRunning())) throw new CandidateError("The candidate container exited before it served HTTP.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new CandidateError(`The candidate did not answer at ${origin} within ${timeoutMs} ms (${last}).`);
}

/** Lists archive members and refuses absolute paths, parent references, links, and more than one root. */
async function inspectArchive(archive: string, sha: string): Promise<string> {
  const { stdout } = await run("tar", ["-tvzf", archive], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }).catch((error: Error) => {
    throw new CandidateError(`The source archive could not be read: ${error.message}`);
  });
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length === 0) throw new CandidateError("The source archive is empty.");
  const roots = new Set<string>();
  for (const line of lines) {
    const type = line[0];
    if (type === "l" || type === "h") throw new CandidateError("The source archive contains links, which the node-server recipe does not support.");
    if (type !== "-" && type !== "d") throw new CandidateError(`The source archive contains an unsupported entry type "${type}".`);
  }
  const { stdout: names } = await run("tar", ["-tzf", archive], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  for (const name of names.split("\n").filter(Boolean)) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new CandidateError(`Unsafe path in the source archive: ${name.slice(0, 200)}`);
    roots.add(name.split("/")[0]!);
  }
  if (roots.size !== 1) throw new CandidateError("The source archive does not have exactly one top-level directory.");
  const root = [...roots][0]!;
  const suffix = root.slice(root.lastIndexOf("-") + 1);
  if (suffix.length < 7 || !sha.startsWith(suffix)) throw new CandidateError(`The archive root "${root}" does not name commit ${sha.slice(0, 12)}.`);
  return root;
}

function insideDir(base: string, relative: string): string {
  const resolved = normalize(join(base, relative));
  if (resolved !== base && !resolved.startsWith(base + sep)) throw new CandidateError(`Path ${relative} leaves the source directory.`);
  return resolved;
}

/** Removes containers left by an interrupted worker. */
export async function cleanupStaleCandidates(settings: Pick<CandidateSettings, "runtime">, log: (m: string, e?: Record<string, unknown>) => void) {
  const names = await run(settings.runtime, ["ps", "-a", "--filter", `label=${LABEL_RUN}`, "--format", "{{.Names}}"], { timeout: 15_000 })
    .then((r) => r.stdout.split("\n").filter(Boolean))
    .catch(() => []);
  for (const name of names) {
    await run(settings.runtime, ["rm", "-f", name], { timeout: 30_000 }).catch(() => undefined);
    log("removed leftover candidate container", { name });
  }
}

export async function startCandidate(spec: CandidateSpec, settings: CandidateSettings, github: GitHubClient): Promise<RunningCandidate> {
  if (!/^[0-9a-f]{40}$/.test(spec.sha)) throw new CandidateError("A full commit SHA is required.");
  const dir = join(settings.workRoot, `${spec.runId}-${spec.label}`);
  const containerName = `faultline-verify-${spec.runId.slice(0, 8)}-${spec.label}`;
  const ports = [settings.basePort, ...spec.recipe.extraPortEnvs.map((_, i) => settings.basePort + i + 1)];
  let started = false;
  const stop = async () => {
    if (started) await run(settings.runtime, ["rm", "-f", containerName], { timeout: 30_000 }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "src"), { recursive: true });
    const archive = await github.downloadTarball(spec.owner, spec.name, spec.sha, settings.maxArchiveBytes);
    const archivePath = join(dir, "source.tar.gz");
    await writeFile(archivePath, archive);
    const archiveSha256 = sha256Hex(archive);
    const root = await inspectArchive(archivePath, spec.sha);
    await run("tar", ["-xzf", archivePath, "-C", join(dir, "src"), "--no-same-owner", "--no-same-permissions"], { timeout: 120_000 });
    const sourceRoot = insideDir(join(dir, "src"), root);
    const appRoot = spec.appDir ? insideDir(sourceRoot, spec.appDir) : sourceRoot;
    const entry = insideDir(appRoot, spec.recipe.entry);
    if (!(await stat(entry).then((s) => s.isFile()).catch(() => false))) throw new CandidateError(`The entry file ${spec.recipe.entry} does not exist at commit ${spec.sha.slice(0, 12)}.`);
    const pkg = await readFile(join(appRoot, "package.json"), "utf8")
      .then((t) => JSON.parse(t) as { dependencies?: Record<string, string> })
      .catch(() => null);
    if (pkg?.dependencies && Object.keys(pkg.dependencies).length > 0) {
      throw new CandidateError(`Commit ${spec.sha.slice(0, 12)} declares runtime dependencies (${Object.keys(pkg.dependencies).slice(0, 5).join(", ")}); the node-server recipe runs without installing packages.`);
    }

    for (const port of ports) {
      if (await portInUse(port)) throw new CandidateError(`Port ${port} on 127.0.0.1 is already in use, so FAULTLINE cannot be sure it would be testing its own candidate.`);
    }
    await ensureNetwork(settings);
    const env = [
      `${spec.recipe.portEnv}=${ports[0]}`,
      ...spec.recipe.extraPortEnvs.map((name, i) => `${name}=${ports[i + 1]}`),
      ...(spec.recipe.hostEnv ? [`${spec.recipe.hostEnv}=0.0.0.0`] : []),
      "NODE_ENV=production",
    ];
    const containerDir = spec.appDir ? `/app/${spec.appDir}` : "/app";
    const args = [
      "run",
      "-d",
      "--name",
      containerName,
      "--label",
      `${LABEL_RUN}=${spec.runId}`,
      "--label",
      `${LABEL_REVISION}=${spec.sha}`,
      "--network",
      settings.network,
      ...ports.flatMap((p) => ["-p", `127.0.0.1:${p}:${p}`]),
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=16m,mode=1777",
      "--cap-drop=all",
      "--security-opt=no-new-privileges",
      "--pids-limit=128",
      "--memory=512m",
      "--cpus=1",
      "--user",
      "65534:65534",
      "-v",
      `${sourceRoot}:/app:ro${settings.runtime === "podman" ? ",z" : ""}`,
      "-w",
      containerDir,
      ...env.flatMap((e) => ["-e", e]),
      settings.image,
      "node",
      spec.recipe.entry,
    ];
    const containerId = await exec(settings.runtime, args, 120_000);
    started = true;
    const origin = `http://localhost:${ports[0]}`;
    const isRunning = async () => (await exec(settings.runtime, ["inspect", containerName, "--format", "{{.State.Running}}"]).catch(() => "false")) === "true";
    await waitForHttp(origin, settings.startTimeoutMs, isRunning);

    const revision = await exec(settings.runtime, ["inspect", containerName, "--format", `{{index .Config.Labels "${LABEL_REVISION}"}}`]);
    const imageId = await exec(settings.runtime, ["inspect", containerName, "--format", "{{.Image}}"]);
    const published = await exec(settings.runtime, ["port", containerName]);
    for (const port of ports) {
      if (!published.includes(`127.0.0.1:${port}`)) throw new CandidateError(`The container does not publish port ${port}; refusing to test whatever answers there.`);
    }
    if (revision !== spec.sha) throw new CandidateError(`The container reports revision ${revision}, expected ${spec.sha}.`);
    return {
      label: spec.label,
      sha: spec.sha,
      origin,
      extraOrigins: ports.slice(1).map((p) => `http://localhost:${p}`),
      archiveSha256,
      archiveBytes: archive.byteLength,
      archiveRoot: root,
      containerName,
      containerId: containerId.slice(0, 64),
      image: settings.image,
      imageId,
      identity: [
        `GitHub source archive for commit ${spec.sha} (SHA-256 ${archiveSha256.slice(0, 16)}…, root ${root}).`,
        `Container ${containerName} labeled ${LABEL_REVISION}=${spec.sha}, image ${settings.image.split("@")[1]?.slice(0, 19) ?? settings.image}.`,
        `Ports ${ports.join(", ")} published on 127.0.0.1 by that container only; they were free before it started.`,
      ],
      stop,
    };
  } catch (error) {
    await stop();
    if (error instanceof CandidateError) throw error;
    throw new CandidateError((error as Error).message);
  }
}
