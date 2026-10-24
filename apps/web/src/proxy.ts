import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects requests without a session cookie to the
 * login page. Real authorization happens in every page, action, and route
 * handler via the data access layer, which validates the session in PostgreSQL.
 */
const PUBLIC_PATHS = ["/login", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = request.cookies.has("__Host-faultline_session") || request.cookies.has("faultline_session");
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
