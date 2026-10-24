import "server-only";
import { and, asc, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { transactionSources } from "@/server/db/schema";
import type { Executor } from "@/server/finance/db-types";

export type SourceRow = typeof transactionSources.$inferSelect;

export const MAX_ATTEMPTS = 8;
const LOCK_MS = 5 * 60_000;

// Exponential backoff: 2, 4, 8 ... minutes, capped at 6 hours.
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(1, attempts) * 60_000, 6 * 3_600_000);
}

// Idempotent: the same message can only be queued once per user and source.
export async function enqueueSource(
  db: Executor,
  row: { userId: string; sourceType: "gmail" | "shortcut" | "statement"; sourceIdentifier: string | null; sourceMessageId: string; receivedAt?: Date | null; payload?: unknown },
  now = new Date(),
): Promise<boolean> {
  const inserted = await db
    .insert(transactionSources)
    .values({
      userId: row.userId,
      sourceType: row.sourceType,
      sourceIdentifier: row.sourceIdentifier,
      sourceMessageId: row.sourceMessageId,
      receivedAt: row.receivedAt ?? null,
      payload: row.payload ?? null,
      // Due immediately, by the caller's clock (not the database's), so scheduling is consistent.
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: transactionSources.id });
  return inserted.length > 0;
}

// Claims due work. Rows stuck in "processing" past their lock (a crashed worker) are reclaimed.
export async function claimBatch(db: Database, limit: number, now = new Date()): Promise<SourceRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: transactionSources.id })
      .from(transactionSources)
      .where(
        or(
          and(eq(transactionSources.parseStatus, "pending"), lte(transactionSources.nextAttemptAt, now)),
          and(eq(transactionSources.parseStatus, "processing"), lt(transactionSources.lockedUntil, now)),
        ),
      )
      .orderBy(asc(transactionSources.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(transactionSources)
      .set({
        parseStatus: "processing",
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        attempts: sql`${transactionSources.attempts} + 1`,
        updatedAt: now,
      })
      .where(inArray(transactionSources.id, due.map((d) => d.id)))
      .returning();
  });
}

export async function completeSource(db: Executor, id: string, fields: Partial<typeof transactionSources.$inferInsert>, now = new Date()) {
  await db
    .update(transactionSources)
    .set({ ...fields, processedAt: now, lockedUntil: null, updatedAt: now })
    .where(eq(transactionSources.id, id));
}

// Transient failure: back to the queue with backoff, or "failed" after too many attempts.
export async function retryLater(db: Executor, row: SourceRow, errorCode: string, message: string, now = new Date(), countAttempt = true) {
  const attempts = countAttempt ? row.attempts : Math.max(0, row.attempts - 1);
  const giveUp = attempts >= MAX_ATTEMPTS;
  await db
    .update(transactionSources)
    .set({
      parseStatus: giveUp ? "failed" : "pending",
      attempts,
      errorCode,
      lastError: message.slice(0, 500),
      nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(transactionSources.id, row.id));
}

// User-requested retry of a failed or unrecognized item (e.g. after a parser update).
export async function resetForRetry(db: Executor, userId: string, ids: string[] | "all-failed", now = new Date()) {
  const scope =
    ids === "all-failed"
      ? inArray(transactionSources.parseStatus, ["failed", "unrecognized"])
      : and(inArray(transactionSources.id, ids), inArray(transactionSources.parseStatus, ["failed", "unrecognized"]));
  const rows = await db
    .update(transactionSources)
    .set({ parseStatus: "pending", attempts: 0, nextAttemptAt: now, errorCode: null, lastError: null, updatedAt: now })
    .where(and(eq(transactionSources.userId, userId), scope))
    .returning({ id: transactionSources.id });
  return rows.length;
}

// Data minimisation: drop kept email excerpts once they're no longer needed for debugging.
export async function purgeExpiredPayloads(db: Executor, now = new Date()) {
  await db
    .update(transactionSources)
    .set({ payload: null, purgePayloadAfter: null, updatedAt: now })
    .where(and(isNotNull(transactionSources.purgePayloadAfter), lt(transactionSources.purgePayloadAfter, now)));
}
