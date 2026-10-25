import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// The repository keeps one .env at its root. Load it for the web server without
// overriding variables already set by the real environment (deployment config wins).
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnv, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Every page is session-gated and reads live scan state, so Cache Components /
  // partial prerendering is intentionally not enabled in Phase 1.
  poweredByHeader: false,
  // Gate runs set NEXT_DIST_DIR=.next-gate so a verification build never replaces the build a
  // running demo server is serving from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Release bundles (scripts/package-release.mjs) set NEXT_OUTPUT=standalone to get a
  // self-contained server.js with only the traced node_modules it needs.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" as const, outputFileTracingRoot: resolve(process.cwd(), "../..") }
    : {}),
  transpilePackages: ["@faultline/shared", "@faultline/db"],
  serverExternalPackages: ["pg", "pg-boss", "@aws-sdk/client-s3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
