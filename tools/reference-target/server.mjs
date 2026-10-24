#!/usr/bin/env node
/**
 * FAULTLINE reference target.
 *
 * A small, deliberately imperfect website you run locally and explicitly
 * allowlist (http://localhost:4600) to verify FAULTLINE end to end. It has
 * real behavior that scans can observe:
 *   - a missing image (real 404 on every load),
 *   - JavaScript that silently depends on a CSS custom property, so it throws
 *     when stylesheets fail to load,
 *   - a /pwa/ page with a service worker that serves a cached copy offline,
 *   - a /shop/ storefront with a real browse → add to cart → shipping quote
 *     workflow backed by JSON APIs, plus a reviews widget and analytics script
 *     loaded from a separate "partner" origin (partner/server.mjs, next port).
 *
 * It is not a FAULTLINE component and never runs in production.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPartnerServer } from "./partner/server.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT ?? 4600);
const partnerPort = Number(process.env.PARTNER_PORT ?? port + 1);
const host = process.env.HOST ?? "127.0.0.1";

const catalog = {
  products: [
    { sku: "TB-01", name: "Trail Backpack", price: 89 },
    { sku: "CB-02", name: "Camp Bottle", price: 24 },
    { sku: "HL-03", name: "Head Lamp", price: 39 },
  ],
};
const inventory = { stock: { "TB-01": 12, "CB-02": 0, "HL-03": 5 } };
const recommendations = { items: ["Rain Shell", "Trekking Poles", "Dry Bag"] };

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": types[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * @param {{ partnerOrigin?: string }} [options] Origin of the partner server the shop page loads scripts from.
 */
export function createReferenceServer(options = {}) {
  const partnerOrigin = options.partnerOrigin ?? `http://localhost:${partnerPort}`;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://reference.local");
    if (url.pathname === "/api/status.json") {
      json(res, 200, { service: "reference-target", region: "local", healthy: true });
      return;
    }
    if (url.pathname === "/api/catalog") return json(res, 200, catalog);
    if (url.pathname === "/api/inventory") return json(res, 200, inventory);
    if (url.pathname === "/api/recommendations") return json(res, 200, recommendations);
    if (url.pathname === "/api/shipping-quote") {
      const zip = url.searchParams.get("zip") ?? "";
      const items = Number(url.searchParams.get("items") ?? "0");
      if (!/^\d{5}$/.test(zip)) return json(res, 400, { error: "Enter a 5-digit ZIP code." });
      return json(res, 200, { zip, cost: 4.5 + Math.max(0, items - 1) * 1.5, days: 3 });
    }
    if (url.pathname === "/api/orders" && req.method === "POST") {
      req.resume();
      return json(res, 201, { orderId: `ord_${Date.now()}`, note: "Reference target only; nothing is stored." });
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(400).end("Bad path");
      return;
    }
    try {
      let body = await readFile(file);
      if (file.endsWith(".html")) body = Buffer.from(body.toString("utf8").replaceAll("{{PARTNER_ORIGIN}}", partnerOrigin));
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const partnerOrigin = `http://localhost:${partnerPort}`;
  createPartnerServer({ publicOrigin: partnerOrigin }).listen(partnerPort, host, () => {
    console.log(`Simulated third-party partner listening on ${partnerOrigin}`);
  });
  createReferenceServer({ partnerOrigin }).listen(port, host, () => {
    console.log(`FAULTLINE reference target listening on http://localhost:${port} (storefront at /shop/)`);
    console.log(`Add http://localhost:${port},${partnerOrigin} to FAULTLINE_SCAN_ALLOWLIST to scan it with its partner.`);
  });
}
