#!/usr/bin/env node
// Starts the reference storefront, the worker, and the web app together, with
// prefixed output. Ctrl+C stops all three. Uses the development servers, so no
// build is needed after a fresh clone.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const processes = [
  ["shop", ["reference-target"]],
  ["worker", ["dev:worker"]],
  ["web", ["dev:web"]],
].map(([name, args]) => {
  const child = spawn("pnpm", ["-s", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join("\n");
  child.stdout.on("data", (chunk) => console.log(prefix(chunk)));
  child.stderr.on("data", (chunk) => console.error(prefix(chunk)));
  child.on("exit", (code) => {
    console.error(`[${name}] exited with code ${code}; stopping the others.`);
    stop(code ?? 1);
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  // Each child leads its own process group, so pnpm's children stop too.
  for (const child of processes) if (child.exitCode === null) process.kill(-child.pid, "SIGTERM");
  setTimeout(() => process.exit(code), 1000);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
console.log("Starting storefront (:4600), worker, and web app (http://localhost:3000). Ctrl+C stops all.");
