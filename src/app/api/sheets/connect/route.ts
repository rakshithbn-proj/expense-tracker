import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/dal";
import { env, sheetsConfig } from "@/server/env";
import { buildGoogleAuthUrl } from "@/server/google/oauth";
import { SHEETS_CONSENT_SCOPES } from "@/server/sheets/client";

export const dynamic = "force-dynamic";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/sheets",
  maxAge: 600,
};

// Starts Google's consent flow for the spreadsheet. `?account=` names the Google account that
// should own it: Google pre-selects it, and the callback refuses any other account. A random
// state value in an HttpOnly cookie ties the callback to this browser session (OAuth CSRF).
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const origin = env().APP_ORIGIN;
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const config = sheetsConfig();
  if (!config) return NextResponse.redirect(new URL("/settings?sheets=not_configured#sheets", origin));

  const raw = new URL(request.url).searchParams.get("account")?.trim().toLowerCase() || undefined;
  const account = raw === undefined ? undefined : z.string().email().max(254).safeParse(raw).data;
  if (raw !== undefined && !account) return NextResponse.redirect(new URL("/settings?sheets=invalid_account#sheets", origin));

  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("sheets_oauth_state", state, cookieOptions);
  if (account) jar.set("sheets_oauth_account", account, cookieOptions);
  else jar.delete({ name: "sheets_oauth_account", path: "/api/sheets" });
  return NextResponse.redirect(buildGoogleAuthUrl(config, SHEETS_CONSENT_SCOPES, state, { loginHint: account, chooseAccount: true }));
}
