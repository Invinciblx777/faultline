"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { operators } from "@faultline/db";
import { dummyPasswordHash, verifyPassword } from "@faultline/shared/password";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "@/lib/auth/rate-limit";
import { createSession, destroySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export interface LoginState {
  error?: string;
  username?: string;
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  next: z.string().max(512).optional(),
});

/** Only same-site relative paths are accepted as post-login destinations. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/projects";
  return next;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: form.get("username"),
    password: form.get("password"),
    next: form.get("next") || undefined,
  });
  if (!parsed.success) return { error: "Enter your username and password." };
  const { username, password } = parsed.data;
  const h = await headers();
  const client = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();

  const limit = loginBlocked(username, client);
  if (limit.blocked) {
    return { error: `Too many failed sign-in attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.`, username };
  }

  const db = getDb();
  const [operator] = await db.select().from(operators).where(eq(sql`lower(${operators.username})`, username.toLowerCase()));
  // Verify against a dummy hash when the account does not exist so timing does not reveal valid usernames.
  const valid = await verifyPassword(password, operator?.passwordHash ?? (await dummyPasswordHash()));
  if (!operator || !valid) {
    recordLoginFailure(username, client);
    return { error: "Username or password is incorrect.", username };
  }
  clearLoginFailures(username);
  await db.update(operators).set({ lastLoginAt: new Date() }).where(eq(operators.id, operator.id));
  await createSession(operator.id);
  redirect(safeNext(parsed.data.next));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
