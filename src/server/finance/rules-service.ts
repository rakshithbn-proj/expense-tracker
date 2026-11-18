import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { RuleMatchType } from "@/lib/finance-types";
import { recordAudit } from "@/server/audit";
import { categoryRules } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertCategoryOwned } from "./categories-service";
import type { Executor } from "./db-types";
import { normalizeRuleValue } from "./merchant";

export async function listRules(db: Executor, userId: string) {
  return db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).orderBy(asc(categoryRules.createdAt));
}

export async function loadActiveRules(db: Executor, userId: string) {
  return db
    .select()
    .from(categoryRules)
    .where(and(eq(categoryRules.userId, userId), eq(categoryRules.isActive, true)));
}

// Creating a rule that already exists (same type and value) re-points it at the new category,
// because the user has explicitly asked for the new mapping. `reason` (the "why") is replaced
// when given (null clears it) and kept when left out.
export async function upsertRule(
  db: Executor,
  userId: string,
  input: { matchType: RuleMatchType; matchValue: string; categoryId: string; reason?: string | null; priority?: number; isSample?: boolean },
) {
  const matchValue = normalizeRuleValue(input.matchType, input.matchValue);
  if (matchValue.length < 2) throw new DomainError("invalid_rule", "The rule needs at least 2 meaningful characters to match.");
  await assertCategoryOwned(db, userId, input.categoryId);
  const reason = input.reason === undefined ? undefined : input.reason?.trim() || null;

  const [row] = await db
    .insert(categoryRules)
    .values({
      userId,
      matchType: input.matchType,
      matchValue,
      categoryId: input.categoryId,
      reason: reason ?? null,
      priority: input.priority ?? 100,
      isSample: input.isSample ?? false,
    })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.matchType, categoryRules.matchValue],
      set: { categoryId: input.categoryId, ...(reason === undefined ? {} : { reason }), isActive: true, updatedAt: new Date() },
    })
    .returning();
  await recordAudit(db, {
    userId,
    entityType: "category_rule",
    entityId: row.id,
    action: "upsert",
    metadata: { matchType: row.matchType, categoryId: row.categoryId, hasReason: row.reason !== null },
  });
  return row;
}

// Sets or clears the "why" a rule files its payments under (new payments only).
export async function setRuleReason(db: Executor, userId: string, id: string, reason: string | null) {
  const value = reason?.trim().slice(0, 500) || null;
  const [row] = await db
    .update(categoryRules)
    .set({ reason: value, updatedAt: new Date() })
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("Rule");
  await recordAudit(db, { userId, entityType: "category_rule", entityId: id, action: "update", metadata: { hasReason: value !== null } });
  return row;
}

export async function setRuleActive(db: Executor, userId: string, id: string, isActive: boolean) {
  const [row] = await db
    .update(categoryRules)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("Rule");
  await recordAudit(db, { userId, entityType: "category_rule", entityId: id, action: "update", metadata: { isActive } });
  return row;
}
