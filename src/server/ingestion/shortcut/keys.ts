import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { deviceKeys, transactionSources } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import type { Executor } from "@/server/finance/db-types";

export const KEY_PREFIX = "etk_";
// Per key; a Shortcut normally sends a handful a day. Protects against a leaked key flooding the app.
export const MAX_SUBMISSIONS_PER_HOUR = 120;

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createDeviceKey(db: Executor, userId: string, name: string) {
  const label = name.trim();
  if (!label || label.length > 60) throw new DomainError("invalid_name", "Give the key a name of up to 60 characters, e.g. “iPhone”.");
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(deviceKeys)
    .values({ userId, name: label, keyHash: hashKey(key), keyPrefix: key.slice(0, KEY_PREFIX.length + 6) })
    .returning({ id: deviceKeys.id, keyPrefix: deviceKeys.keyPrefix });
  await recordAudit(db, { userId, entityType: "device_key", entityId: row.id, action: "create", metadata: { name: label } });
  // The only time the key exists in plain text.
  return { id: row.id, key, keyPrefix: row.keyPrefix };
}

export async function listDeviceKeys(db: Executor, userId: string) {
  return db
    .select({
      id: deviceKeys.id,
      name: deviceKeys.name,
      keyPrefix: deviceKeys.keyPrefix,
      createdAt: deviceKeys.createdAt,
      lastUsedAt: deviceKeys.lastUsedAt,
      revokedAt: deviceKeys.revokedAt,
    })
    .from(deviceKeys)
    .where(eq(deviceKeys.userId, userId))
    .orderBy(desc(deviceKeys.createdAt));
}

export async function revokeDeviceKey(db: Executor, userId: string, id: string) {
  const [row] = await db
    .update(deviceKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceKeys.id, id), eq(deviceKeys.userId, userId), isNull(deviceKeys.revokedAt)))
    .returning({ id: deviceKeys.id });
  if (!row) throw new NotFoundError("Active key");
  await recordAudit(db, { userId, entityType: "device_key", entityId: id, action: "revoke" });
}

export type AuthenticatedDevice = { keyId: string; userId: string; name: string };

// Returns null for a missing, malformed, unknown or revoked key; callers answer 401 without details.
export async function authenticateDeviceKey(db: Executor, authorization: string | null, now = new Date()): Promise<AuthenticatedDevice | null> {
  const key = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 200) return null;
  const [row] = await db
    .select({ id: deviceKeys.id, userId: deviceKeys.userId, name: deviceKeys.name })
    .from(deviceKeys)
    .where(and(eq(deviceKeys.keyHash, hashKey(key)), isNull(deviceKeys.revokedAt)));
  if (!row) return null;
  await db.update(deviceKeys).set({ lastUsedAt: now }).where(eq(deviceKeys.id, row.id));
  return { keyId: row.id, userId: row.userId, name: row.name };
}

export const deviceSourceIdentifier = (keyId: string) => `device:${keyId}`;

export async function isRateLimited(db: Executor, keyId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(transactionSources)
    .where(
      and(
        eq(transactionSources.sourceType, "shortcut"),
        eq(transactionSources.sourceIdentifier, deviceSourceIdentifier(keyId)),
        gte(transactionSources.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  return (row?.n ?? 0) >= MAX_SUBMISSIONS_PER_HOUR;
}
