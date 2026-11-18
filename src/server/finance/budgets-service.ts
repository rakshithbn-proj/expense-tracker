import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { isValidMonth } from "@/lib/dates";
import { decimalToPaise, paiseToDecimal } from "@/lib/money";
import { recordAudit } from "@/server/audit";
import { budgets } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { UNCATEGORIZED } from "./accounting";
import { budgetInForce, evaluateBudget } from "./budget";
import { assertCategoryOwned } from "./categories-service";
import type { Executor } from "./db-types";
import { summarizeMonth } from "./transactions-service";

// Sets the limit that applies from `fromMonth` onward. Setting it again for the same month replaces it.
export async function setBudget(
  db: Executor,
  userId: string,
  input: { categoryId: string | null; reason?: string | null; fromMonth: string; limitPaise: number; warnAtPercent?: number },
) {
  const reason = cleanReason(input.reason);
  if (!isValidMonth(input.fromMonth)) throw new DomainError("invalid_month", "Use a month like 2026-10.");
  if (!Number.isSafeInteger(input.limitPaise) || input.limitPaise <= 0) {
    throw new DomainError("invalid_limit", "The budget must be a positive amount.");
  }
  const warnAtPercent = input.warnAtPercent ?? 80;
  if (!Number.isInteger(warnAtPercent) || warnAtPercent < 1 || warnAtPercent > 100) {
    throw new DomainError("invalid_threshold", "The warning threshold must be 1–100%.");
  }
  if (input.categoryId) await assertCategoryOwned(db, userId, input.categoryId);

  const values = {
    userId,
    categoryId: input.categoryId,
    reason,
    periodStart: `${input.fromMonth}-01`,
    limitAmount: paiseToDecimal(input.limitPaise),
    warnAtPercent,
  };
  const [row] = await db
    .insert(budgets)
    .values(values)
    .onConflictDoUpdate({
      target: [budgets.userId, budgets.categoryId, budgets.reason, budgets.periodStart],
      set: { limitAmount: values.limitAmount, warnAtPercent, updatedAt: new Date() },
    })
    .returning();
  await recordAudit(db, {
    userId,
    entityType: "budget",
    entityId: row.id,
    action: "set",
    metadata: { categoryId: input.categoryId, reason, fromMonth: input.fromMonth, limit: values.limitAmount },
  });
  return row;
}

// Blank means "all spending" (null). Otherwise the exact text used as a transaction's reason.
function cleanReason(reason: string | null | undefined): string | null {
  const r = reason?.trim() ?? "";
  if (r.length > 500) throw new DomainError("invalid_reason", "The why is too long.");
  return r === "" ? null : r;
}

const sameReason = (reason: string | null) => (reason === null ? isNull(budgets.reason) : eq(budgets.reason, reason));

// Budgets are settings, not financial records: removing one deletes its rows (audited).
export async function removeBudget(db: Executor, userId: string, categoryId: string | null, reasonInput: string | null = null) {
  const reason = cleanReason(reasonInput);
  const deleted = await db
    .delete(budgets)
    .where(and(eq(budgets.userId, userId), categoryId ? eq(budgets.categoryId, categoryId) : isNull(budgets.categoryId), sameReason(reason)))
    .returning({ id: budgets.id });
  await recordAudit(db, {
    userId,
    entityType: "budget",
    entityId: categoryId ?? "overall",
    action: "remove",
    metadata: { reason, rows: deleted.length },
  });
}

// Every budget row; with `reason` (null = all spending) only that "why"'s rows.
export async function listBudgets(db: Executor, userId: string, reason?: string | null) {
  return db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), ...(reason === undefined ? [] : [sameReason(cleanReason(reason))])));
}

// The "why"s that have at least one budget (null = all spending).
export async function budgetReasons(db: Executor, userId: string): Promise<(string | null)[]> {
  const rows = await db.selectDistinct({ reason: budgets.reason }).from(budgets).where(eq(budgets.userId, userId));
  return rows.map((r) => r.reason);
}

// Budget usage for one month and one "why" (null = all spending), using the same accounting as
// every other total. A "why"'s budgets count only payments explained with that "why".
export async function budgetReport(db: Executor, userId: string, month: string, reasonInput: string | null = null) {
  if (!isValidMonth(month)) throw new DomainError("invalid_month", "Use a month like 2026-10.");
  const reason = cleanReason(reasonInput);
  const [rows, summary] = await Promise.all([listBudgets(db, userId, reason), summarizeMonth(db, userId, month, reason)]);

  const byCategory = new Map<string | null, typeof rows>();
  for (const r of rows) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);

  const evaluate = (categoryId: string | null, spent: number) => {
    const active = budgetInForce(byCategory.get(categoryId) ?? [], month);
    return active
      ? { categoryId, budgetId: active.id, ...evaluateBudget(decimalToPaise(active.limitAmount), spent, active.warnAtPercent) }
      : null;
  };

  const overall = evaluate(null, summary.netSpendPaise);
  const categories = [...byCategory.keys()]
    .filter((k): k is string => k !== null)
    .map((categoryId) => evaluate(categoryId, summary.byCategory[categoryId] ?? 0))
    .filter((b) => b !== null);

  return {
    month,
    reason,
    overall,
    categories,
    uncategorizedSpendPaise: summary.byCategory[UNCATEGORIZED] ?? 0,
    definition: "Net spending: purchases and fees minus refunds. Excludes own-account transfers, card bill payments, income, investments and cash withdrawals.",
  };
}
