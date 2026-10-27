import "server-only";
import { isIP } from "node:net";
import { and, count, eq, gte } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IP = 5;
// Caps distributed guessing against the single account.
export const MAX_FAILURES_GLOBAL = 20;

// Caddy (or Traefik, which drops untrusted forwarded headers) overwrites X-Forwarded-For with the real client address, so the first entry is trusted.
export function normalizeIp(raw: string | null | undefined): string | null {
  const candidate = raw?.split(",")[0]?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

export async function isLoginBlocked(
  database: Database,
  ip: string | null,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const failedSince = and(eq(loginAttempts.succeeded, false), gte(loginAttempts.attemptedAt, since));

  const [global] = await database.select({ n: count() }).from(loginAttempts).where(failedSince);
  if ((global?.n ?? 0) >= MAX_FAILURES_GLOBAL) return true;

  if (ip) {
    const [perIp] = await database
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(failedSince, eq(loginAttempts.ip, ip)));
    if ((perIp?.n ?? 0) >= MAX_FAILURES_PER_IP) return true;
  }
  return false;
}

export async function recordLoginAttempt(
  database: Database,
  ip: string | null,
  succeeded: boolean,
  now = new Date(),
): Promise<void> {
  await database.insert(loginAttempts).values({ ip, succeeded, attemptedAt: now });
}
