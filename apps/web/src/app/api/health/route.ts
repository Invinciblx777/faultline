import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** Liveness/readiness probe. Reveals nothing beyond whether the database is reachable. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
