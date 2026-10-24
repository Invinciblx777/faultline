import { describe, expect, it } from "vitest";
import { DevinApiError, DevinClient, devinConfigFromEnv, devinTimestamp, GitHubApiError, GitHubClient } from "../src/integrations";

const KEY = "cog_test_key_0123456789";
const SESSION = {
  session_id: "devin-abc123",
  url: "https://app.devin.ai/sessions/devin-abc123",
  status: "running",
  status_detail: "working",
  tags: ["faultline", "faultline-repair-x"],
  org_id: "org-1",
  created_at: 1761330000,
  updated_at: 1761330060,
  acus_consumed: 1.5,
  pull_requests: [],
};

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(responses: Array<Response | Error>, maxAttempts = 3) {
  const fake = fakeFetch(responses);
  const sleeps: number[] = [];
  const devin = new DevinClient({ apiKey: KEY, orgId: "org-1", baseUrl: "https://api.devin.test", fetch: fake.impl, maxAttempts, sleep: async (ms) => void sleeps.push(ms) });
  return { devin, calls: fake.calls, sleeps };
}

describe("Devin configuration", () => {
  it("requires both values, a cog_ key, and an org- id", () => {
    expect(devinConfigFromEnv({})).toEqual({ configured: false, reason: "DEVIN_API_KEY and DEVIN_ORG_ID are not set." });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: KEY })).toMatchObject({ configured: false });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: "apk_legacy", DEVIN_ORG_ID: "org-1" })).toMatchObject({ configured: false, reason: expect.stringContaining("cog_") });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: KEY, DEVIN_ORG_ID: "acme" })).toMatchObject({ configured: false });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: KEY, DEVIN_ORG_ID: "org-1", DEVIN_API_BASE_URL: "http://api.example.com" })).toMatchObject({ configured: false });
    expect(devinConfigFromEnv({ DEVIN_API_KEY: ` ${KEY} `, DEVIN_ORG_ID: "org-1" })).toEqual({ configured: true, apiKey: KEY, orgId: "org-1", baseUrl: "https://api.devin.ai" });
  });

  it("reads integer timestamps as seconds or milliseconds", () => {
    expect(devinTimestamp(1761330000).toISOString()).toBe("2025-10-24T18:20:00.000Z");
    expect(devinTimestamp(1761330000000).toISOString()).toBe("2025-10-24T18:20:00.000Z");
  });
});

describe("Devin client", () => {
  it("sends the bearer key only in the Authorization header and validates the session", async () => {
    const { devin, calls } = client([json(200, SESSION)]);
    const session = await devin.createSession({ prompt: "fix", tags: ["faultline"], repos: ["acme/shop"] });
    expect(session.session_id).toBe("devin-abc123");
    expect(calls[0]!.url).toBe("https://api.devin.test/v3/organizations/org-1/sessions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ prompt: "fix", tags: ["faultline"], repos: ["acme/shop"] });
    expect(String(calls[0]!.url)).not.toContain(KEY);
  });

  it("rejects responses that do not match the documented schema", async () => {
    const { devin } = client([json(200, { session_id: "x" })]);
    await expect(devin.getSession("x")).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("categorizes errors with actionable messages and never echoes the key", async () => {
    for (const [status, category] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [422, "invalid_request"],
    ] as const) {
      const { devin } = client([json(status, { title: "Problem", status, detail: `bad ${KEY}`.replace(KEY, "detail") })]);
      const error = (await devin.getSession("devin-1").catch((e: unknown) => e)) as DevinApiError;
      expect(error).toBeInstanceOf(DevinApiError);
      expect(error.category).toBe(category);
      expect(error.message).not.toContain(KEY);
    }
  });

  it("retries reads on 429 and 503 with bounded backoff, honoring Retry-After", async () => {
    const { devin, calls, sleeps } = client([json(429, { title: "slow down", status: 429 }, { "retry-after": "2" }), json(503, { title: "unavailable", status: 503 }), json(200, SESSION)]);
    await expect(devin.getSession("devin-abc123")).resolves.toMatchObject({ status: "running" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("gives up after the attempt limit", async () => {
    const { devin, calls } = client([json(503, {}), json(503, {}), json(503, {})]);
    await expect(devin.getSession("devin-1")).rejects.toMatchObject({ category: "server_error", ambiguous: false });
    expect(calls).toHaveLength(3);
  });

  it("retries session creation only when Devin refused it (429)", async () => {
    const refused = client([json(429, { title: "rate", status: 429 }), json(200, SESSION)]);
    await expect(refused.devin.createSession({ prompt: "p" })).resolves.toMatchObject({ session_id: "devin-abc123" });
    expect(refused.calls).toHaveLength(2);
  });

  it("never repeats a session creation whose outcome is unknown", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const lost = client([timeout, json(200, SESSION)]);
    await expect(lost.devin.createSession({ prompt: "p" })).rejects.toMatchObject({ category: "timeout", ambiguous: true });
    expect(lost.calls).toHaveLength(1);
    const failed = client([json(502, {}), json(200, SESSION)]);
    await expect(failed.devin.createSession({ prompt: "p" })).rejects.toMatchObject({ category: "server_error", ambiguous: true });
    expect(failed.calls).toHaveLength(1);
  });

  it("finds sessions by tag and filters locally", async () => {
    const other = { ...SESSION, session_id: "devin-other", tags: ["unrelated"] };
    const { devin, calls } = client([json(200, { items: [SESSION, other], has_next_page: false, end_cursor: null })]);
    const found = await devin.findSessionsByTag("faultline-repair-x", new Date("2026-10-24T00:00:00Z"));
    expect(found.map((s) => s.session_id)).toEqual(["devin-abc123"]);
    expect(calls[0]!.url).toContain("tags=faultline-repair-x");
  });

  it("pages messages with the documented cursor parameters", async () => {
    const { devin, calls } = client([json(200, { items: [{ event_id: "e1", source: "devin", message: "Looking at shop.js", created_at: 1761330001 }], has_next_page: true, end_cursor: "c1" })]);
    const page = await devin.listMessages("devin-abc123", "c0");
    expect(page.items[0]!.event_id).toBe("e1");
    expect(page.end_cursor).toBe("c1");
    expect(calls[0]!.url).toBe("https://api.devin.test/v3/organizations/org-1/sessions/devin-abc123/messages?first=100&after=c0");
  });
});

describe("GitHub client", () => {
  const pr = {
    number: 3,
    html_url: "https://github.com/acme/shop/pull/3",
    state: "open",
    merged: false,
    draft: false,
    title: "Fix",
    body: null,
    created_at: "2026-10-24T18:00:00Z",
    updated_at: "2026-10-24T18:05:00Z",
    merged_at: null,
    closed_at: null,
    base: { ref: "main", sha: "b".repeat(40), repo: { full_name: "acme/shop" } },
    head: { ref: "devin/fix", sha: "c".repeat(40), repo: { full_name: "acme/shop" } },
  };

  it("maps pull request facts and sends the token as a bearer header", async () => {
    const fake = fakeFetch([json(200, pr)]);
    const github = new GitHubClient({ token: "ghp_test", fetch: fake.impl });
    const facts = await github.getPullRequest("acme", "shop", 3);
    expect(facts).toMatchObject({ number: 3, headSha: "c".repeat(40), baseRef: "main", baseRepoFullName: "acme/shop", state: "open", merged: false });
    expect((fake.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
  });

  it("explains 404s and refuses malformed names and short SHAs", async () => {
    const github = new GitHubClient({ token: null, fetch: fakeFetch([json(404, {})]).impl });
    await expect(github.getRepository("acme", "missing")).rejects.toThrow(/cannot read it/);
    await expect(github.getRepository("../x", "y")).rejects.toBeInstanceOf(GitHubApiError);
    await expect(github.getCommit("acme", "shop", "abc")).rejects.toThrow(/40-character/);
  });

  it("enforces the archive size limit while streaming", async () => {
    const big = new Response(new Uint8Array(2048), { status: 200 });
    const github = new GitHubClient({ token: null, fetch: fakeFetch([big]).impl });
    await expect(github.downloadTarball("acme", "shop", "d".repeat(40), 1024)).rejects.toThrow(/limit/);
  });
});
