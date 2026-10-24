import { config } from "dotenv";
import { fileURLToPath } from "node:url";

/** Loads the repository-root .env for CLI scripts. Real environment variables take precedence. */
export function loadRootEnv() {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
}
