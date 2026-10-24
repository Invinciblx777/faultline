import { readFileSync, rmSync } from "node:fs";
import { PID_FILE } from "./global-setup";

export default async function globalTeardown() {
  try {
    const pid = Number(readFileSync(PID_FILE, "utf8"));
    // Negative pid signals the whole process group (pnpm + tsx + node).
    process.kill(-pid, "SIGTERM");
  } catch {
    // already stopped
  }
  rmSync(PID_FILE, { force: true });
}
