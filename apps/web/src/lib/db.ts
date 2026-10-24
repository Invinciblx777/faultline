import "server-only";
import { createDatabase, type DatabaseHandle } from "@faultline/db";
import { getEnv } from "./env";

const globalForDb = globalThis as unknown as { faultlineDb?: DatabaseHandle };

/** One pool per server process (survives dev hot reloads). */
export function getDb() {
  globalForDb.faultlineDb ??= createDatabase(getEnv().DATABASE_URL, { max: 10, applicationName: "faultline-web" });
  return globalForDb.faultlineDb.db;
}
