#!/usr/bin/env node
// Creates .env from .env.example with freshly generated local secrets.
// Refuses to overwrite an existing .env.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".env");
if (existsSync(target)) {
  console.error(".env already exists. Remove it first if you want to regenerate secrets.");
  process.exit(1);
}
const pg = randomBytes(24).toString("base64url");
const minio = randomBytes(24).toString("base64url");
const content = readFileSync(join(root, ".env.example"), "utf8")
  .replaceAll("change-me-too", minio)
  .replaceAll("change-me", pg);
writeFileSync(target, content, { mode: 0o600 });
console.log("Wrote .env with generated database and object storage secrets (mode 600).");
