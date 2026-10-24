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
 *   - a /pwa/ page with a service worker that serves a cached copy offline.
 *
 * It is not a FAULTLINE component and never runs in production.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const port = Number(process.env.PORT ?? 4600);
const host = process.env.HOST ?? "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function createReferenceServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://reference.local");
    if (url.pathname === "/api/status.json") {
      res.writeHead(200, { "content-type": types[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify({ service: "reference-target", region: "local", healthy: true }));
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(400).end("Bad path");
      return;
    }
    try {
      const body = await readFile(file);
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
  createReferenceServer().listen(port, host, () => {
    console.log(`FAULTLINE reference target listening on http://localhost:${port}`);
    console.log(`Add http://localhost:${port} to FAULTLINE_SCAN_ALLOWLIST to scan it.`);
  });
}
