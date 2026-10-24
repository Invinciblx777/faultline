import { runMigrations } from "../src/migrate";
import { loadRootEnv } from "./env";

loadRootEnv();
const url = process.argv.includes("--test") ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!url) {
  console.error(process.argv.includes("--test") ? "DATABASE_URL_TEST is not set." : "DATABASE_URL is not set.");
  process.exit(1);
}
await runMigrations(url);
console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}.`);
