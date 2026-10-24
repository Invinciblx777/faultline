import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseAllowlist } from "@faultline/shared";
import { EGRESS_BLOCK_HEADER, EgressGuard } from "../src/egress-guard";
import { listen, type RunningServer } from "./fixtures";

const guards: EgressGuard[] = [];
const servers: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(guards.splice(0).map((g) => g.stop()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function setup(allow: (port: number) => string, maxTransferBytes = 10_000_000) {
  const upstream = await listen(http.createServer((_req, res) => res.end("x".repeat(5000))));
  servers.push(upstream);
  const guard = new EgressGuard({
    policy: { mode: "local", allowlist: parseAllowlist(allow(upstream.port)), subresourcePolicy: "public" },
    maxTransferBytes,
  });
  guards.push(guard);
  const proxy = await guard.start();
  return { guard, proxy, upstream };
}

function viaProxy(proxyPort: number, target: string, auth?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxyPort, path: target, headers: auth ? { "proxy-authorization": auth } : {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function connect(proxyPort: number, target: string, auth: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${auth}\r\n\r\n`);
    });
    socket.once("data", (chunk) => {
      resolve(chunk.toString().split("\r\n")[0] ?? "");
      socket.destroy();
    });
    socket.on("error", reject);
  });
}

const basic = (g: EgressGuard) => `Basic ${Buffer.from(`${g.username}:${g.password}`).toString("base64")}`;

describe("EgressGuard", () => {
  it("requires its per-execution proxy credentials", async () => {
    const { proxy, upstream } = await setup((p) => `http://localhost:${p}`);
    const res = await viaProxy(proxy.port, `http://localhost:${upstream.port}/`);
    expect(res.status).toBe(407);
    const wrong = await viaProxy(proxy.port, `http://localhost:${upstream.port}/`, "Basic d3Jvbmc6d3Jvbmc=");
    expect(wrong.status).toBe(407);
  });

  it("forwards allowlisted plain HTTP and counts bytes", async () => {
    const { guard, proxy, upstream } = await setup((p) => `http://localhost:${p}`);
    const res = await viaProxy(proxy.port, `http://localhost:${upstream.port}/`, basic(guard));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5000);
    expect(guard.transferredBytes).toBeGreaterThanOrEqual(5000);
  });

  it("refuses unlisted loopback ports over HTTP and CONNECT and logs why", async () => {
    const { guard, proxy, upstream } = await setup(() => "http://localhost:1");
    const res = await viaProxy(proxy.port, `http://127.0.0.1:${upstream.port}/`, basic(guard));
    expect(res.status).toBe(403);
    expect(res.headers[EGRESS_BLOCK_HEADER]).toMatch(/^blocked/);
    expect(await connect(proxy.port, `127.0.0.1:${upstream.port}`, basic(guard))).toBe("HTTP/1.1 403 Forbidden");
    expect(await connect(proxy.port, "169.254.169.254:80", basic(guard))).toBe("HTTP/1.1 403 Forbidden");
    expect(guard.blocked.map((b) => b.reason)).toEqual(expect.arrayContaining(["port_not_allowed", "metadata_endpoint"]));
  });

  it("cuts traffic once the transfer budget is exhausted", async () => {
    const { guard, proxy, upstream } = await setup((p) => `http://localhost:${p}`, 4000);
    await viaProxy(proxy.port, `http://localhost:${upstream.port}/`, basic(guard)).catch(() => undefined);
    expect(guard.transferBudgetExhausted).toBe(true);
    const after = await viaProxy(proxy.port, `http://localhost:${upstream.port}/`, basic(guard));
    expect(after.status).toBe(403);
  });
});
