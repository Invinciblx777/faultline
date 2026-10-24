import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(connectionString: string, options: { max?: number; applicationName?: string } = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "faultline",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Without a listener, an idle client error (e.g. database restart) would crash the process.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
