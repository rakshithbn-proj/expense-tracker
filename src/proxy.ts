import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";

// Optimistic check only: a missing cookie is redirected early. The session itself is
// validated against the database in the data access layer (src/server/auth/dal.ts).
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    // Everything except public assets, the login page and the health check.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.webmanifest|icon|apple-icon|pwa-icons|login|api/health).*)",
  ],
};
