import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { sourceHealth } from "@/server/db/schema";
import type { Executor } from "@/server/finance/db-types";

export type HealthOutcome = { ok: true } | { ok: false; code: string; status?: string };

export async function recordHealth(
  db: Executor,
  userId: string,
  source: { type: "gmail" | "shortcut" | "statement"; name: string },
  outcome: HealthOutcome,
  now = new Date(),
) {
  const values = {
    userId,
    sourceType: source.type,
    sourceName: source.name,
    lastAttemptAt: now,
    updatedAt: now,
    ...(outcome.ok
      ? { lastSuccessAt: now, lastErrorCode: null, consecutiveFailures: 0, status: "operational" }
      : { lastErrorCode: outcome.code, consecutiveFailures: 1, status: outcome.status ?? "failing" }),
  };
  await db
    .insert(sourceHealth)
    .values(values)
    .onConflictDoUpdate({
      target: [sourceHealth.userId, sourceHealth.sourceType, sourceHealth.sourceName],
      set: outcome.ok
        ? { lastAttemptAt: now, lastSuccessAt: now, lastErrorCode: null, consecutiveFailures: 0, status: "operational", updatedAt: now }
        : {
            lastAttemptAt: now,
            lastErrorCode: outcome.code,
            consecutiveFailures: sql`${sourceHealth.consecutiveFailures} + 1`,
            status: outcome.status ?? "failing",
            updatedAt: now,
          },
    });
}

export async function setHealthStatus(db: Executor, userId: string, source: { type: "gmail"; name: string }, status: string) {
  await db
    .update(sourceHealth)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(sourceHealth.userId, userId), eq(sourceHealth.sourceType, source.type), eq(sourceHealth.sourceName, source.name)));
}
