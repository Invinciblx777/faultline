import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { and, eq, gt, lt } from "drizzle-orm";
import { operatorSessions, operators } from "@faultline/db";
import { getDb } from "../db";
import { cookieSecure, getEnv } from "../env";

export interface CurrentOperator {
  id: string;
  username: string;
  sessionId: string;
}

export function sessionCookieName(): string {
  // The __Host- prefix pins the cookie to this host and path "/" and requires Secure.
  return cookieSecure() ? "__Host-faultline_session" : "faultline_session";
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a server-side session and sets an opaque, httpOnly cookie. Must run in a Server Action or Route Handler. */
export async function createSession(operatorId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + getEnv().FAULTLINE_SESSION_TTL_HOURS * 3600_000);
  const db = getDb();
  await db.insert(operatorSessions).values({ tokenHash: hashToken(token), operatorId, expiresAt });
  // Opportunistic cleanup of expired sessions.
  await db.delete(operatorSessions).where(lt(operatorSessions.expiresAt, new Date()));
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolves the signed-in operator for this request, or null. Cached per request. */
export const getCurrentOperator = cache(async (): Promise<CurrentOperator | null> => {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token || token.length > 128) return null;
  const db = getDb();
  const [row] = await db
    .select({ sessionId: operatorSessions.id, id: operators.id, username: operators.username, lastSeenAt: operatorSessions.lastSeenAt })
    .from(operatorSessions)
    .innerJoin(operators, eq(operators.id, operatorSessions.operatorId))
    .where(and(eq(operatorSessions.tokenHash, hashToken(token)), gt(operatorSessions.expiresAt, new Date())));
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(operatorSessions).set({ lastSeenAt: new Date() }).where(eq(operatorSessions.id, row.sessionId));
  }
  return { id: row.id, username: row.username, sessionId: row.sessionId };
});

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) await getDb().delete(operatorSessions).where(eq(operatorSessions.tokenHash, hashToken(token)));
  store.delete(sessionCookieName());
}
