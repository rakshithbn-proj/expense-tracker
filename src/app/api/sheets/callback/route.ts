import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/dal";
import { db } from "@/server/db/client";
import { env, sheetsConfig } from "@/server/env";
import { exchangeGoogleCode, revokeGoogleToken, verifiedEmailFromIdToken } from "@/server/google/oauth";
import { logger } from "@/server/logger";
import { saveSheetsConnection, syncSheets } from "@/server/sheets/service";

export const dynamic = "force-dynamic";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request) {
  const origin = env().APP_ORIGIN;
  const done = (result: string) => NextResponse.redirect(new URL(`/settings?sheets=${result}#sheets`, origin));
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const config = sheetsConfig();
  if (!config) return done("not_configured");

  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("sheets_oauth_state")?.value;
  const wantedAccount = jar.get("sheets_oauth_account")?.value ?? null;
  jar.delete({ name: "sheets_oauth_state", path: "/api/sheets" });
  jar.delete({ name: "sheets_oauth_account", path: "/api/sheets" });
  const state = url.searchParams.get("state");
  if (!expected || !state || !sameState(expected, state)) return done("state_mismatch");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code) return done("error");

  try {
    const tokens = await exchangeGoogleCode(config, code);
    const email = verifiedEmailFromIdToken(tokens.id_token);
    if (wantedAccount && email !== wantedAccount) {
      // Approved with a different account than the one chosen: don't keep that access.
      if (tokens.refresh_token) await revokeGoogleToken(tokens.refresh_token);
      else await revokeGoogleToken(tokens.access_token);
      return done("wrong_account");
    }
    if (!tokens.refresh_token) return done("no_refresh_token");
    await saveSheetsConnection(db(), user.id, { refreshToken: tokens.refresh_token, scope: tokens.scope, emailAddress: email }, config);
  } catch (err) {
    logger.warn({ event: "sheets_connect_failed", err: err instanceof Error ? err.message : String(err) });
    return done("error");
  }
  // First sync right away, so the user sees the spreadsheet link. Failures are shown in Settings.
  const result = await syncSheets(db(), user.id, { config }, { force: true });
  return done(result.status === "synced" ? "connected" : "connected_sync_failed");
}
