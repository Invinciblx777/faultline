import { randomBytes, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { redactUrl } from "@faultline/shared";
import { resolveAndEvaluate, type EgressDecision, type EgressPolicy, type Resolver } from "@faultline/shared/network";

/**
 * FAULTLINE egress guard.
 *
 * A loopback-only HTTP/CONNECT forward proxy that every browser connection is
 * forced through. For each connection it:
 *   1. resolves the destination hostname itself,
 *   2. checks every resolved address against the egress policy,
 *   3. connects to the exact address it checked (no second DNS lookup).
 *
 * Because enforcement happens at connection time, it covers the initial
 * navigation, HTTP redirects, subresources, iframes, WebSockets, service
 * worker fetches, and DNS rebinding, which in-page request interception alone
 * cannot. It is an application-level control; public deployments must still
 * add OS/network egress isolation (see docs/security.md).
 */

export const EGRESS_BLOCK_HEADER = "x-faultline-egress";

export interface EgressBlockRecord {
  at: Date;
  host: string;
  port: number;
  /** "connect" for HTTPS/WebSocket tunnels, "http" for plain HTTP requests. */
  via: "connect" | "http" | "upgrade";
  reason: string;
  message: string;
  url?: string;
}

export interface UpstreamFailureRecord {
  at: Date;
  host: string;
  port: number;
  /** Socket error code from the last address tried, e.g. ECONNREFUSED. */
  code: string;
}

export interface EgressGuardOptions {
  policy: EgressPolicy;
  /** Total bytes (both directions) allowed through the guard before all traffic is cut. */
  maxTransferBytes: number;
  resolver?: Resolver;
  /** Timeout for establishing upstream TCP connections. */
  connectTimeoutMs?: number;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Connects to the first reachable address among those that passed the policy check. */
function connectFirst(addresses: Array<{ address: string; family: 4 | 6 }>, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let index = 0;
    let lastCode = "EUNREACHABLE";
    const attempt = () => {
      const target = addresses[index++];
      if (!target) {
        reject(Object.assign(new Error("No reachable address"), { code: lastCode }));
        return;
      }
      const socket = net.connect({ host: target.address, port, family: target.family });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error("connect timeout")));
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.removeAllListeners("error");
        resolve(socket);
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        lastCode = error.code ?? (error.message === "connect timeout" ? "ETIMEDOUT" : "EUNKNOWN");
        socket.destroy();
        attempt();
      });
    };
    attempt();
  });
}

export class EgressGuard {
  readonly username = "faultline";
  readonly password = randomBytes(24).toString("base64url");
  readonly blocked: EgressBlockRecord[] = [];
  readonly upstreamFailures: UpstreamFailureRecord[] = [];
  private readonly expectedAuth: Buffer;
  private readonly sockets = new Set<Duplex>();
  private server: http.Server | null = null;
  private transferred = 0;
  private budgetExhausted = false;

  constructor(private readonly options: EgressGuardOptions) {
    this.expectedAuth = Buffer.from(`Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`);
  }

  get transferredBytes(): number {
    return this.transferred;
  }

  get transferBudgetExhausted(): boolean {
    return this.budgetExhausted;
  }

  /** True if a connection to host:port was refused by policy. */
  wasBlocked(host: string, port: number): EgressBlockRecord | undefined {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    return this.blocked.find((b) => b.host === h && b.port === port);
  }

  async start(): Promise<{ server: string; username: string; password: string; port: number }> {
    const server = http.createServer((req, res) => void this.handleHttp(req, res));
    server.on("connect", (req: IncomingMessage, socket: Duplex, head: Buffer) => void this.handleConnect(req, socket, head));
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => void this.handleUpgrade(req, socket, head));
    server.on("connection", (socket: Socket) => this.track(socket));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Egress guard failed to bind");
    return { server: `http://127.0.0.1:${address.port}`, username: this.username, password: this.password, port: address.port };
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private track(socket: Duplex) {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers["proxy-authorization"];
    if (typeof header !== "string") return false;
    const actual = Buffer.from(header);
    return actual.length === this.expectedAuth.length && timingSafeEqual(actual, this.expectedAuth);
  }

  private count(bytes: number) {
    this.transferred += bytes;
    if (!this.budgetExhausted && this.transferred > this.options.maxTransferBytes) {
      this.budgetExhausted = true;
      for (const socket of this.sockets) socket.destroy();
    }
  }

  private meter(socket: Duplex) {
    socket.on("data", (chunk: Buffer) => this.count(chunk.length));
  }

  private async decide(host: string, port: number): Promise<EgressDecision> {
    if (this.budgetExhausted) {
      return { allowed: false, reason: "invalid_destination", message: "Transfer budget exhausted for this execution." };
    }
    return resolveAndEvaluate(host, port, this.options.policy, this.options.resolver);
  }

  /** The most recent upstream connection failure for host:port, if any. */
  upstreamFailure(host: string, port: number): UpstreamFailureRecord | undefined {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    return this.upstreamFailures.findLast((f) => f.host === h && f.port === port);
  }

  private recordUpstreamFailure(host: string, port: number, error: unknown): string {
    const code = (error as NodeJS.ErrnoException).code ?? "EUNKNOWN";
    if (this.upstreamFailures.length < 500) {
      this.upstreamFailures.push({ at: new Date(), host: host.toLowerCase().replace(/^\[|\]$/g, ""), port, code });
    }
    return code;
  }

  private record(entry: Omit<EgressBlockRecord, "at">) {
    if (this.blocked.length < 500) this.blocked.push({ at: new Date(), ...entry, host: entry.host.toLowerCase().replace(/^\[|\]$/g, "") });
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse) {
    if (!this.authorized(req)) {
      res.writeHead(407, { "proxy-authenticate": 'Basic realm="faultline"', connection: "close" }).end();
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400, { connection: "close" }).end("Bad proxy request");
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400, { connection: "close" }).end("Only http:// is proxied without CONNECT");
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const decision = await this.decide(target.hostname, port);
    if (!decision.allowed) {
      this.record({ host: target.hostname, port, via: "http", reason: decision.reason, message: decision.message, url: redactUrl(target.toString()) });
      res
        .writeHead(403, { [EGRESS_BLOCK_HEADER]: `blocked; reason=${decision.reason}`, "content-type": "text/plain", connection: "close" })
        .end(`Blocked by FAULTLINE egress guard: ${decision.message}`);
      return;
    }
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    let socket: Socket;
    try {
      // Connect to an address that passed the policy check; never re-resolve the hostname.
      socket = await connectFirst(decision.addresses, port, this.options.connectTimeoutMs ?? 15_000);
    } catch (error) {
      const code = this.recordUpstreamFailure(target.hostname, port, error);
      res.writeHead(502, { [EGRESS_BLOCK_HEADER]: `upstream-failed; code=${code}`, connection: "close" }).end();
      return;
    }
    // Node's HTTP parser reads the socket directly (no 'data' events), so plain HTTP is
    // metered on the request and response streams instead of the socket.
    this.track(socket);
    const upstream = http.request({
      host: target.hostname,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      createConnection: () => socket,
      agent: false,
    });
    upstream.on("response", (upstreamRes) => {
      const outHeaders: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, outHeaders);
      upstreamRes.on("data", (chunk: Buffer) => this.count(chunk.length));
      upstreamRes.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { connection: "close" }).end();
      else res.destroy();
    });
    req.on("data", (chunk: Buffer) => this.count(chunk.length));
    req.pipe(upstream);
  }

  private async handleConnect(req: IncomingMessage, client: Duplex, head: Buffer) {
    if (!this.authorized(req)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="faultline"\r\nConnection: close\r\n\r\n');
      return;
    }
    const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url ?? "");
    if (!match) {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const host = match[1]!;
    const port = Number(match[2]);
    const decision = await this.decide(host, port);
    if (!decision.allowed) {
      this.record({ host, port, via: "connect", reason: decision.reason, message: decision.message });
      client.end(`HTTP/1.1 403 Forbidden\r\n${EGRESS_BLOCK_HEADER}: blocked; reason=${decision.reason}\r\nConnection: close\r\n\r\n`);
      return;
    }
    let upstream: Socket;
    try {
      upstream = await connectFirst(decision.addresses, port, this.options.connectTimeoutMs ?? 15_000);
    } catch (error) {
      const code = this.recordUpstreamFailure(host, port, error);
      if (client.writable) client.end(`HTTP/1.1 502 Bad Gateway\r\n${EGRESS_BLOCK_HEADER}: upstream-failed; code=${code}\r\nConnection: close\r\n\r\n`);
      return;
    }
    this.track(upstream);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    this.meter(upstream);
    this.meter(client);
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  }

  /** Plain `ws://` upgrades sent directly to the proxy (Chromium normally tunnels these via CONNECT). */
  private async handleUpgrade(req: IncomingMessage, client: Duplex, head: Buffer) {
    if (!this.authorized(req)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="faultline"\r\nConnection: close\r\n\r\n');
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const decision = await this.decide(target.hostname, port);
    if (!decision.allowed) {
      this.record({ host: target.hostname, port, via: "upgrade", reason: decision.reason, message: decision.message, url: redactUrl(target.toString()) });
      client.end(`HTTP/1.1 403 Forbidden\r\n${EGRESS_BLOCK_HEADER}: blocked; reason=${decision.reason}\r\nConnection: close\r\n\r\n`);
      return;
    }
    let upstream: Socket;
    try {
      upstream = await connectFirst(decision.addresses, port, this.options.connectTimeoutMs ?? 15_000);
    } catch (error) {
      this.recordUpstreamFailure(target.hostname, port, error);
      client.destroy();
      return;
    }
    this.track(upstream);
    {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!;
        if (name.toLowerCase().startsWith("proxy-")) continue;
        lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      this.meter(upstream);
      this.meter(client);
      upstream.pipe(client);
      client.pipe(upstream);
    }
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  }
}
