import "server-only";
import { count, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { recordAudit } from "@/server/audit";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/server/auth/password";
import { invalidateAllUserSessions } from "@/server/auth/session";

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Single-user app: creating a second account is refused.
export async function createOwner(database: Database, email: string, password: string) {
  const problem = validateNewPassword(password);
  if (problem) throw new Error(problem);

  const [existing] = await database.select({ n: count() }).from(users);
  if ((existing?.n ?? 0) > 0) throw new Error("A user already exists. Use reset-password instead.");

  const [user] = await database
    .insert(users)
    .values({ email: email.trim().toLowerCase(), passwordHash: await hashPassword(password) })
    .returning({ id: users.id, email: users.email });
  await recordAudit(database, { userId: user.id, entityType: "user", entityId: user.id, action: "create" });
  return user;
}

// Server-side recovery path (run over SSH). Signs out every existing session.
export async function resetPassword(database: Database, email: string, password: string) {
  const problem = validateNewPassword(password);
  if (problem) throw new Error(problem);

  const [user] = await database
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ id: users.id, email: users.email });
  if (!user) throw new Error("No user with that email.");

  await invalidateAllUserSessions(database, user.id);
  await recordAudit(database, {
    userId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "password_reset",
  });
  return user;
}
