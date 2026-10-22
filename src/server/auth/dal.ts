import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { SESSION_COOKIE } from "./cookie";
import { validateSessionToken, type SessionUser } from "./session";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// Validated once per request. proxy.ts only does an optimistic cookie-presence check;
// this is the real authorization point for pages, actions and route handlers.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  const session = await validateSessionToken(db(), token);
  return session?.user ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}
