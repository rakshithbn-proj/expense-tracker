// Pure breakdowns built on the accounting rules. Every value here is derived from
// spendingEffect(), so reports always agree with the summary totals.
import { addMonths, daysBetween } from "@/lib/dates";
import type { CaptureMethod, Direction, PaymentMethod, TransactionStatus, TransactionType } from "@/lib/finance-types";
import type { LedgerTransaction } from "./accounting";

export type AnalyzedTx = {
  id: string;
  date: string;
  merchant: string | null; // display name
  merchantKey: string | null; // normalized, for grouping
  accountId: string | null;
  paymentMethod: PaymentMethod;
  paymentApp: string | null;
  type: TransactionType;
  direction: Direction;
  status: TransactionStatus;
  amountPaise: number;
  currency: string;
  // Signed contribution to net spending (0 when it isn't spending), and the category it counts in.
  effectPaise: number;
  effectCategoryId: string | null;
  captureMethod: CaptureMethod;
  isSample: boolean;
  ledger: LedgerTransaction; // what summarize() consumes
};

export type Group = { key: string; paise: number; count: number };

// Net spending grouped by any key. Only transactions with a spending effect are included.
export function groupSpending(items: AnalyzedTx[], keyOf: (t: AnalyzedTx) => string | null, fallback = "unknown"): Group[] {
  const map = new Map<string, Group>();
  for (const t of items) {
    if (t.effectPaise === 0) continue;
    const key = keyOf(t) ?? fallback;
    const g = map.get(key) ?? { key, paise: 0, count: 0 };
    g.paise += t.effectPaise;
    g.count++;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.paise - a.paise || a.key.localeCompare(b.key));
}

export const totalSpending = (items: AnalyzedTx[]) => items.reduce((s, t) => s + t.effectPaise, 0);

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Running net spending for each day 1..days of a month.
export function cumulativeByDay(items: AnalyzedTx[], month: string, days = daysInMonth(month)): number[] {
  const daily = new Array<number>(days).fill(0);
  for (const t of items) {
    if (!t.date.startsWith(month)) continue;
    const day = Number(t.date.slice(8, 10));
    if (day <= days) daily[day - 1] += t.effectPaise;
  }
  let running = 0;
  return daily.map((v) => (running += v));
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Net spending per weekday, plus how many of each weekday the range contains (for averages).
export function weekdayPattern(items: AnalyzedTx[], start: string, endInclusive: string) {
  const totals = new Array<number>(7).fill(0);
  const occurrences = new Array<number>(7).fill(0);
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  for (let d = 0; d <= daysBetween(start, endInclusive); d++) {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    occurrences[weekday(date)]++;
  }
  for (const t of items) totals[weekday(t.date)] += t.effectPaise;
  return WEEKDAYS.map((label, i) => ({
    label,
    totalPaise: totals[i],
    averagePaise: occurrences[i] ? Math.round(totals[i] / occurrences[i]) : 0,
    days: occurrences[i],
  }));
}

// UPI versus cards versus everything else, for the payment-method report.
export function channelOf(method: PaymentMethod): "UPI" | "Cards" | "Other" {
  if (method === "upi") return "UPI";
  if (method === "credit_card" || method === "debit_card") return "Cards";
  return "Other";
}

// ---------------------------------------------------------------------------
// Recurring payments
// ---------------------------------------------------------------------------

export type RecurringPayment = {
  merchantKey: string;
  merchant: string;
  typicalPaise: number;
  monthsSeen: number;
  monthsChecked: number;
  lastDate: string;
  categoryId: string | null;
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

// A merchant is "recurring" when it is charged a similar amount (within 15% of the median) in
// at least 3 different months, about once a month. Frequent merchants (several times a month,
// e.g. food delivery) are deliberately excluded.
export function detectRecurring(items: AnalyzedTx[], monthsChecked: number): RecurringPayment[] {
  const byMerchant = new Map<string, AnalyzedTx[]>();
  for (const t of items) {
    if (t.effectPaise <= 0 || !t.merchantKey || (t.type !== "purchase" && t.type !== "fee")) continue;
    byMerchant.set(t.merchantKey, [...(byMerchant.get(t.merchantKey) ?? []), t]);
  }

  const out: RecurringPayment[] = [];
  for (const [merchantKey, txs] of byMerchant) {
    const typical = median(txs.map((t) => t.amountPaise));
    const similar = txs.filter((t) => Math.abs(t.amountPaise - typical) <= typical * 0.15);
    const months = new Set(similar.map((t) => t.date.slice(0, 7)));
    if (months.size < 3 || txs.length / months.size > 1.5) continue;
    const last = similar.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({
      merchantKey,
      merchant: last.merchant ?? merchantKey,
      typicalPaise: typical,
      monthsSeen: months.size,
      monthsChecked,
      lastDate: last.date,
      categoryId: last.effectCategoryId,
    });
  }
  return out.sort((a, b) => b.typicalPaise - a.typicalPaise);
}

// ---------------------------------------------------------------------------
// Unusual-spending insights
// ---------------------------------------------------------------------------

export type Insight = {
  scope: "overall" | "category";
  categoryId: string | null; // for scope "category": null means uncategorized
  currentPaise: number;
  averagePaise: number;
  changePercent: number | null; // null when there was no spending before
  throughDay: number;
  comparisonMonths: string[];
};

export type InsightResult =
  | { status: "ok"; insights: Insight[]; throughDay: number; comparisonMonths: string[] }
  | { status: "insufficient_history"; requiredFrom: string };

const MIN_DIFFERENCE_PAISE = 500_00;
const OVERALL = Symbol("overall");
const MIN_CHANGE = 0.25;

// Compares spending in days 1..D of `month` with the average of the same days in the previous
// three months, per category and overall. Only reports differences of at least 25% and ₹500.
// Requires data going back at least to the start of the earliest comparison month.
export function unusualSpending(
  items: AnalyzedTx[],
  month: string,
  throughDay: number,
  earliestTransactionDate: string | null,
): InsightResult {
  const comparisonMonths = [1, 2, 3].map((n) => addMonths(month, -n)).reverse();
  if (!earliestTransactionDate || earliestTransactionDate > `${comparisonMonths[0]}-01`) {
    return { status: "insufficient_history", requiredFrom: `${comparisonMonths[0]}-01` };
  }

  const inWindow = (t: AnalyzedTx, m: string) =>
    t.date.startsWith(m) && Number(t.date.slice(8, 10)) <= Math.min(throughDay, daysInMonth(m));
  const sumBy = (m: string) => {
    const map = new Map<string | null | typeof OVERALL, number>();
    for (const t of items) {
      if (t.effectPaise === 0 || !inWindow(t, m)) continue;
      map.set(t.effectCategoryId, (map.get(t.effectCategoryId) ?? 0) + t.effectPaise);
      map.set(OVERALL, (map.get(OVERALL) ?? 0) + t.effectPaise);
    }
    return map;
  };

  const current = sumBy(month);
  const previous = comparisonMonths.map(sumBy);
  const keys = new Set([...current.keys(), ...previous.flatMap((p) => [...p.keys()])]);

  const insights: Insight[] = [];
  for (const key of keys) {
    const cur = current.get(key) ?? 0;
    const avg = Math.round(previous.reduce((s, p) => s + (p.get(key) ?? 0), 0) / 3);
    const diff = cur - avg;
    if (Math.abs(diff) < MIN_DIFFERENCE_PAISE) continue;
    if (avg > 0 && Math.abs(diff) / avg < MIN_CHANGE) continue;
    if (avg <= 0 && cur <= 0) continue;
    insights.push({
      scope: key === OVERALL ? "overall" : "category",
      categoryId: key === OVERALL ? null : key,
      currentPaise: cur,
      averagePaise: avg,
      changePercent: avg > 0 ? Math.round((diff / avg) * 100) : null,
      throughDay,
      comparisonMonths,
    });
  }
  insights.sort(
    (a, b) =>
      (a.scope === "overall" ? -1 : 0) - (b.scope === "overall" ? -1 : 0) ||
      Math.abs(b.currentPaise - b.averagePaise) - Math.abs(a.currentPaise - a.averagePaise),
  );
  return { status: "ok", insights: insights.slice(0, 6), throughDay, comparisonMonths };
}

// ---------------------------------------------------------------------------
// Budget suggestions (shown for approval, never saved automatically)
// ---------------------------------------------------------------------------

export type BudgetSuggestion = {
  scope: "overall" | "category";
  categoryId: string | null; // for scope "category": null means uncategorized
  averagePaise: number;
  suggestedPaise: number;
  months: string[];
};

// Average net spending over the three complete months before `month`, rounded up to ₹500.
export function suggestBudgets(items: AnalyzedTx[], month: string, earliestTransactionDate: string | null): BudgetSuggestion[] | null {
  const months = [1, 2, 3].map((n) => addMonths(month, -n)).reverse();
  if (!earliestTransactionDate || earliestTransactionDate > `${months[0]}-01`) return null;

  const totals = new Map<string | null | typeof OVERALL, number>();
  for (const t of items) {
    if (t.effectPaise === 0 || !months.includes(t.date.slice(0, 7))) continue;
    totals.set(t.effectCategoryId, (totals.get(t.effectCategoryId) ?? 0) + t.effectPaise);
    totals.set(OVERALL, (totals.get(OVERALL) ?? 0) + t.effectPaise);
  }
  const step = 500_00;
  return [...totals.entries()]
    .map(([key, total]) => {
      const averagePaise = Math.round(total / 3);
      return {
        scope: key === OVERALL ? ("overall" as const) : ("category" as const),
        categoryId: key === OVERALL ? null : key,
        averagePaise,
        suggestedPaise: Math.max(step, Math.ceil(averagePaise / step) * step),
        months,
      };
    })
    .filter((s) => s.averagePaise > 0)
    .sort((a, b) => b.averagePaise - a.averagePaise);
}
