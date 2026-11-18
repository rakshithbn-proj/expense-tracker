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
  startMonth: string;
  today: AllowanceToday;
};

// The daily allowance of one "why"'s total budget (null = the all-spending budget), or null when
// that total has no budget. Category budgets are deliberately left out (the user wants the math
// on the total only). Spending is the same net spending as every other total.
export async function dailyAllowance(db: Executor, userId: string, today: string, reason: string | null = null): Promise<DailyAllowance | null> {
  const currentMonth = today.slice(0, 7);
  const rows = (await listBudgets(db, userId, reason)).filter((r) => r.categoryId === null);
  if (rows.length === 0 || !budgetInForce(rows, currentMonth)) return null;

  const first = rows.reduce((a, b) => (a.periodStart < b.periodStart ? a : b)).periodStart.slice(0, 7);
  const startMonth = first > DAILY_ALLOWANCE_START ? first : DAILY_ALLOWANCE_START;
  if (startMonth > currentMonth) return null;

  const months: AllowanceMonth[] = [];
  for (let m = startMonth; m <= currentMonth; m = addMonths(m, 1)) {
    const active = budgetInForce(rows, m);
    months.push({ month: m, limitPaise: active ? decimalToPaise(active.limitAmount) : 0, dailySpendPaise: new Array(daysInMonthOf(m)).fill(0) });
  }
  const index = new Map(months.map((m) => [m.month, m]));
  const loaded = await loadAnalyzed(db, userId, { start: `${startMonth}-01`, endExclusive: addDays(today, 1) });
  for (const t of loaded.items) {
    if (t.effectPaise === 0 || (reason !== null && t.reason !== reason)) continue;
    const m = index.get(t.date.slice(0, 7));
    if (m) m.dailySpendPaise[Number(t.date.slice(8, 10)) - 1] += t.effectPaise;
  }
  const next = budgetInForce(rows, addMonths(currentMonth, 1));
  return { startMonth, today: allowanceToday(months, today, next ? decimalToPaise(next.limitAmount) : 0) };
}
