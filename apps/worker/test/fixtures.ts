import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
// The reference target is plain ESM JavaScript.
// @ts-expect-error -- no type declarations for the .mjs tool
import { createReferenceServer } from "../../../tools/reference-target/server.mjs";
// @ts-expect-error -- no type declarations for the .mjs tool
import { createPartnerServer } from "../../../tools/reference-target/partner/server.mjs";

export interface RunningServer {
  origin: string;
  port: number;
  close: () => Promise<void>;
}

export async function listen(server: Server, host = "127.0.0.1"): Promise<RunningServer> {
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function startReferenceTarget(): Promise<RunningServer> {
  return listen(createReferenceServer() as Server);
}

/** The reference storefront plus its simulated third-party partner on a second origin. */
export async function startStorefront(): Promise<{ shop: RunningServer; partner: RunningServer }> {
  const partnerOptions = { publicOrigin: "" };
  const partner = await listen(createPartnerServer(partnerOptions) as Server);
  partnerOptions.publicOrigin = partner.origin;
  const shop = await listen(createReferenceServer({ partnerOrigin: partner.origin }) as Server);
  return { shop, partner };
}

/**
 * Test-only copy of the storefront with one change a developer could make:
 * stock levels become optional, so the product grid renders (with stock
 * unknown) when the inventory API fails. Used to show that a generated
 * regression test passes once the application tolerates the fault.
 */
export async function startFixedStorefront(partnerOrigin: string): Promise<RunningServer> {
  const original = readFileSync(new URL("../../../tools/reference-target/public/shop/shop.js", import.meta.url), "utf8");
  const before = `const [catalog, inventory] = await Promise.all([getJSON("/api/catalog"), getJSON("/api/inventory")]);
    state.products = catalog.products;
    state.stock = inventory.stock;`;
  const after = `const [catalog, inventory] = await Promise.allSettled([getJSON("/api/catalog"), getJSON("/api/inventory")]);
    if (catalog.status === "rejected") throw catalog.reason;
    state.products = catalog.value.products;
    state.stock = inventory.status === "fulfilled" ? inventory.value.stock : Object.fromEntries(state.products.map((p) => [p.sku, 1]));`;
  if (!original.includes(before)) throw new Error("Storefront source changed; update the fixed-storefront fixture.");
  const fixed = original.replace(before, after);
  const inner = createReferenceServer({ partnerOrigin }) as Server;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/shop/shop.js")) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }).end(fixed);
      return;
    }
    inner.emit("request", req, res);
  });
  return listen(server);
}

/**
 * Edge-case server for failure handling tests. Bound to loopback; tests
 * authorize it explicitly through the allowlist.
 */
export function startEdgeCaseServer(otherPort: () => number): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://edge.local");
    switch (url.pathname) {
      case "/server-error":
        res.writeHead(500, { "content-type": "text/html" }).end("<title>Broken</title><h1>Internal error</h1>");
        return;
      case "/hang":
        // Never respond: exercises the navigation timeout.
        return;
      case "/redirect-out":
        res.writeHead(302, { location: `http://127.0.0.1:${otherPort()}/` }).end();
        return;
      case "/redirect-loop":
        res.writeHead(302, { location: "/redirect-loop" }).end();
        return;
      case "/private-subresource":
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Sub</title><h1>Hello</h1><img src="http://127.0.0.1:${otherPort()}/secret.png">`);
        return;
      case "/password-form":
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Sign in</title><label>Email <input name="email"></label><label>Password <input type="password" name="pw"></label>`);
        return;
      case "/secret-page":
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=abc123" }).end("<title>Secret</title>");
        return;
      case "/console":
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Console</title><script>console.error("boom token=supersecretvalue"); console.warn("careful"); null.x;</script>`);
        return;
      default:
        res.writeHead(200, { "content-type": "text/html" }).end("<title>Edge OK</title><p>ok</p>");
    }
  });
  return listen(server);
}
