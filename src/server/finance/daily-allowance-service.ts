import "server-only";
import { addDays, addMonths } from "@/lib/dates";
import { allowanceToday, daysInMonthOf, type AllowanceMonth, type AllowanceToday } from "@/lib/daily-allowance";
import { decimalToPaise } from "@/lib/money";
import { budgetInForce } from "./budget";
import { listBudgets } from "./budgets-service";
import type { Executor } from "./db-types";
import { loadAnalyzed } from "./reports-service";

// The user chose to start the daily allowance from November 2026; a budget first set later
// starts from its own first month. Leftovers and overspends roll forward from there.
export const DAILY_ALLOWANCE_START = "2026-11";

export type DailyAllowance = {
  categoryId: string | null; // null = the overall budget (for the chosen "why")
  startMonth: string;
  today: AllowanceToday;
};

// One daily allowance per budget in force today, for one "why" (null = all spending). Spending is
// the same net spending as every other total, so a budget and its allowance always agree.
export async function dailyAllowances(db: Executor, userId: string, today: string, reason: string | null = null): Promise<DailyAllowance[]> {
  const currentMonth = today.slice(0, 7);
  const rows = await listBudgets(db, userId, reason);

  const byCategory = new Map<string | null, typeof rows>();
  for (const r of rows) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);

  const plans = [...byCategory.entries()]
    .map(([categoryId, budgetRows]) => {
      const first = budgetRows.reduce((a, b) => (a.periodStart < b.periodStart ? a : b)).periodStart.slice(0, 7);
      return { categoryId, budgetRows, startMonth: first > DAILY_ALLOWANCE_START ? first : DAILY_ALLOWANCE_START };
    })
    .filter((p) => p.startMonth <= currentMonth && budgetInForce(p.budgetRows, currentMonth));
  if (plans.length === 0) return [];

  const earliest = plans.reduce((a, p) => (p.startMonth < a ? p.startMonth : a), currentMonth);
  const loaded = await loadAnalyzed(db, userId, { start: `${earliest}-01`, endExclusive: addDays(today, 1) });
  const items = loaded.items.filter((t) => t.effectPaise !== 0 && (reason === null || t.reason === reason));

  const result = plans.map(({ categoryId, budgetRows, startMonth }) => {
    const months: AllowanceMonth[] = [];
    for (let m = startMonth; m <= currentMonth; m = addMonths(m, 1)) {
      const active = budgetInForce(budgetRows, m);
      months.push({ month: m, limitPaise: active ? decimalToPaise(active.limitAmount) : 0, dailySpendPaise: new Array(daysInMonthOf(m)).fill(0) });
    }
    const index = new Map(months.map((m) => [m.month, m]));
    for (const t of items) {
      if (categoryId !== null && t.effectCategoryId !== categoryId) continue;
      const m = index.get(t.date.slice(0, 7));
      if (m) m.dailySpendPaise[Number(t.date.slice(8, 10)) - 1] += t.effectPaise;
    }
    const next = budgetInForce(budgetRows, addMonths(currentMonth, 1));
    return { categoryId, startMonth, today: allowanceToday(months, today, next ? decimalToPaise(next.limitAmount) : 0) };
  });
  // Overall first, then categories in a stable order.
  return result.sort((a, b) => (a.categoryId === null ? -1 : b.categoryId === null ? 1 : a.categoryId.localeCompare(b.categoryId)));
}
