import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./client";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies pending SQL migrations. Safe to run repeatedly. */
export async function runMigrations(connectionString: string, migrationsFolder = MIGRATIONS_FOLDER) {
  const handle = createDatabase(connectionString, { max: 1, applicationName: "faultline-migrate" });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}
