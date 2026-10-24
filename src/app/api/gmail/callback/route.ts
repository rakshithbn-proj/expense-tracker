import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { env, gmailConfig } from "@/server/env";
import { GmailClient } from "@/server/ingestion/gmail/client";
import { saveConnection } from "@/server/ingestion/gmail/service";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request) {
  const origin = env().APP_ORIGIN;
  const done = (result: string) => NextResponse.redirect(new URL(`/automation?gmail=${result}`, origin));
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const config = gmailConfig();
  if (!config) return done("not_configured");

  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("gmail_oauth_state")?.value;
  jar.delete({ name: "gmail_oauth_state", path: "/api/gmail" });
  const state = url.searchParams.get("state");
  if (!expected || !state || !sameState(expected, state)) return done("state_mismatch");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code) return done("error");

  try {
    const tokens = await GmailClient.exchangeCode(config, code);
    if (!tokens.refresh_token) return done("no_refresh_token");
    const client = new GmailClient(config, tokens.refresh_token);
    const profile = await client.getProfile();
    await saveConnection(db(), user.id, { emailAddress: profile.emailAddress, refreshToken: tokens.refresh_token, scope: tokens.scope }, config);
    return done("connected");
  } catch (err) {
    logger.warn({ event: "gmail_connect_failed", err: err instanceof Error ? err.message : String(err) });
    return done("error");
  }
}
