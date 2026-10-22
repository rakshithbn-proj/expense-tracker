import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
// Sliding renewal: extend once less than half the lifetime remains.
const RENEW_THRESHOLD_MS = 15 * DAY_MS;

export type SessionUser = { id: string; email: string };
export type ValidatedSession = { sessionId: string; expiresAt: Date; user: SessionUser };

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  database: Database,
  userId: string,
  userAgent: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await database.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt,
    createdAt: now,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function validateSessionToken(
  database: Database,
  token: string,
  now = new Date(),
): Promise<ValidatedSession | null> {
  const sessionId = hashSessionToken(token);
  const [row] = await database
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await database.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  let expiresAt = row.expiresAt;
  if (expiresAt.getTime() - now.getTime() < RENEW_THRESHOLD_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await database.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
  }

  return { sessionId, expiresAt, user: { id: row.userId, email: row.email } };
}

export async function invalidateSession(database: Database, token: string): Promise<void> {
  await database.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}

export async function invalidateAllUserSessions(database: Database, userId: string): Promise<void> {
  await database.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(database: Database, now = new Date()): Promise<void> {
  await database.delete(sessions).where(lt(sessions.expiresAt, now));
}
