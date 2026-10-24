import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/dal";
import { env, gmailConfig } from "@/server/env";
import { buildAuthUrl } from "@/server/ingestion/gmail/client";

export const dynamic = "force-dynamic";

// Starts Google's consent flow. A random state value in an HttpOnly cookie ties the callback
// to this browser session (OAuth CSRF protection).
export async function GET() {
  const user = await getCurrentUser();
  const origin = env().APP_ORIGIN;
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const config = gmailConfig();
  if (!config) return NextResponse.redirect(new URL("/automation?gmail=not_configured", origin));

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthUrl(config, state));
}
