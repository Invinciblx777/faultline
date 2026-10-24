import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitHubClient } from "@faultline/shared/integrations";
import { runtimeAvailable, startCandidate, type CandidateSettings, type CandidateSpec } from "../src/repair/candidate";

const run = promisify(execFile);

/*
 * Real container build of a real commit. Needs podman (or docker) and a
 * GitHub token that can read the repository; skipped otherwise, with the
 * reason printed. Defaults to the FAULTLINE reference storefront repository.
 */
const OWNER = process.env.FAULTLINE_TEST_REPO_OWNER ?? "Invinciblx777";
const NAME = process.env.FAULTLINE_TEST_REPO_NAME ?? "faultline-reference-shop";
const SHA = process.env.FAULTLINE_TEST_REPO_SHA ?? "6c9ca4c946664392b54d530fdae95886f7f8daf4";
const RUNTIME = (process.env.FAULTLINE_CONTAINER_RUNTIME as "podman" | "docker" | undefined) ?? "podman";
const IMAGE = process.env.FAULTLINE_VERIFY_IMAGE ?? "docker.io/library/node@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284";

const runtime = await runtimeAvailable({ runtime: RUNTIME });
const skipReason = !process.env.GITHUB_TOKEN ? "GITHUB_TOKEN is not set" : !runtime.ok ? runtime.reason : null;
if (skipReason) console.warn(`Skipping container verification tests: ${skipReason}`);

describe.skipIf(Boolean(skipReason))("isolated candidate builds", () => {
  let workRoot: string;
  let settings: CandidateSettings;
  const github = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? null });
  const spec = (over: Partial<CandidateSpec> = {}): CandidateSpec => ({
    runId: "0c0ffee0-0000-4000-8000-000000000000",
    label: "candidate",
    owner: OWNER,
    name: NAME,
    sha: SHA,
    appDir: null,
    recipe: { kind: "node-server", entry: "server.mjs", portEnv: "PORT", extraPortEnvs: ["PARTNER_PORT"], hostEnv: "HOST" },
    ...over,
  });

  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), "faultline-candidate-"));
    settings = { runtime: RUNTIME, image: IMAGE, network: "faultline-verify-test", basePort: 4795, workRoot, maxArchiveBytes: 20 * 1024 * 1024, startTimeoutMs: 30_000 };
  });

  afterAll(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  it("serves the exact commit from a locked-down container with no outbound network", async () => {
    const candidate = await startCandidate(spec(), settings, github);
    try {
      expect(candidate.sha).toBe(SHA);
      expect(candidate.origin).toBe("http://localhost:4795");
      expect(candidate.extraOrigins).toEqual(["http://localhost:4796"]);
      expect(SHA.startsWith(candidate.archiveRoot.slice(candidate.archiveRoot.lastIndexOf("-") + 1)), candidate.archiveRoot).toBe(true);
      expect(candidate.archiveSha256).toMatch(/^[0-9a-f]{64}$/);

      const page = await fetch(`${candidate.origin}/shop/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("shop.js");

      const inspect = JSON.parse((await run(RUNTIME, ["inspect", candidate.containerName])).stdout)[0];
      expect(inspect.Config.Labels["faultline.revision"]).toBe(SHA);
      expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
      expect(inspect.Config.User).toBe("65534:65534");

      // The candidate's code cannot reach the internet.
      const probe = await run(RUNTIME, ["exec", candidate.containerName, "node", "-e", "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0),()=>process.exit(3))"]).then(
        () => 0,
        (error: { code?: number }) => error.code ?? -1,
      );
      expect(probe).toBe(3);
    } finally {
      await candidate.stop();
    }
    const left = (await run(RUNTIME, ["ps", "-a", "--filter", `name=${candidate.containerName}`, "--format", "{{.Names}}"])).stdout.trim();
    expect(left).toBe("");
  }, 120_000);

  it("refuses a commit GitHub cannot resolve", async () => {
    await expect(startCandidate(spec({ sha: "f".repeat(40) }), settings, github)).rejects.toThrow();
  }, 60_000);

  it("refuses to start when something else already answers on the verification port", async () => {
    const squatter = createServer().listen(4795, "127.0.0.1");
    await new Promise((resolve) => squatter.once("listening", resolve));
    try {
      await expect(startCandidate(spec(), settings, github)).rejects.toThrow(/already in use/);
    } finally {
      squatter.close();
    }
  }, 60_000);
});
