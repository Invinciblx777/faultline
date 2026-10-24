import "server-only";
import { NextResponse } from "next/server";
import { getCurrentOperator } from "./auth/session";

export async function apiOperator() {
  return getCurrentOperator();
}

export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export function notFoundJson() {
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
}
