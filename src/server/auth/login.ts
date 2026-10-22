import "server-only";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { burnPasswordCheck, verifyPassword } from "./password";
import { isLoginBlocked, normalizeIp, recordLoginAttempt } from "./rate-limit";
import { createSession } from "./session";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

// Framework-free so it can be tested directly against the database.
export async function attemptLogin(
  database: Database,
  input: { email: string; password: string; ip: string | null; userAgent: string | null },
): Promise<LoginResult> {
  const ip = normalizeIp(input.ip);
  if (await isLoginBlocked(database, ip)) {
    return { ok: false, reason: "rate_limited" };
  }

  const email = input.email.trim().toLowerCase();
  const [user] = await database.select().from(users).where(eq(users.email, email)).limit(1);

  let valid = false;
  if (user) {
    valid = await verifyPassword(user.passwordHash, input.password);
  } else {
    await burnPasswordCheck(input.password);
  }

  await recordLoginAttempt(database, ip, valid);

  if (!user || !valid) {
    return { ok: false, reason: "invalid" };
  }

  const session = await createSession(database, user.id, input.userAgent);
  await database.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAudit(database, { userId: user.id, entityType: "user", entityId: user.id, action: "login" });
  return { ok: true, ...session };
}
