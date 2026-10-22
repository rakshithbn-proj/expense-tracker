import "server-only";
import { eq } from "drizzle-orm";
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
  input: { categoryId: string | null; fromMonth: string; limitPaise: number; warnAtPercent?: number },
) {
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
    periodStart: `${input.fromMonth}-01`,
    limitAmount: paiseToDecimal(input.limitPaise),
    warnAtPercent,
  };
  const [row] = await db
    .insert(budgets)
    .values(values)
    .onConflictDoUpdate({
      target: [budgets.userId, budgets.categoryId, budgets.periodStart],
      set: { limitAmount: values.limitAmount, warnAtPercent, updatedAt: new Date() },
    })
    .returning();
  await recordAudit(db, {
    userId,
    entityType: "budget",
    entityId: row.id,
    action: "set",
    metadata: { categoryId: input.categoryId, fromMonth: input.fromMonth, limit: values.limitAmount },
  });
  return row;
}

export async function listBudgets(db: Executor, userId: string) {
  return db.select().from(budgets).where(eq(budgets.userId, userId));
}

// Budget usage for one month, using the same accounting as every other total.
export async function budgetReport(db: Executor, userId: string, month: string) {
  if (!isValidMonth(month)) throw new DomainError("invalid_month", "Use a month like 2026-10.");
  const [rows, summary] = await Promise.all([listBudgets(db, userId), summarizeMonth(db, userId, month)]);

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
    overall,
    categories,
    uncategorizedSpendPaise: summary.byCategory[UNCATEGORIZED] ?? 0,
    definition: "Net spending: purchases and fees minus refunds. Excludes own-account transfers, card bill payments, income, investments and cash withdrawals.",
  };
}
