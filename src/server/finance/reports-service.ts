import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, min, or } from "drizzle-orm";
import { addMonths, istDate, monthRange } from "@/lib/dates";
import { decimalToPaise } from "@/lib/money";
import { categories, financialAccounts, transactions } from "@/server/db/schema";
import { spendingEffect, summarize, type LedgerTransaction, type ParentInfo } from "./accounting";
import {
  cumulativeByDay,
  daysInMonth,
  detectRecurring,
  groupSpending,
  suggestBudgets,
  unusualSpending,
  weekdayPattern,
  type AnalyzedTx,
} from "./analytics";
import { budgetReport } from "./budgets-service";
import type { Executor } from "./db-types";
import { toDto } from "./transactions-service";

type Range = { start: string; endExclusive: string };

export type Analyzed = { items: AnalyzedTx[]; parents: Map<string, ParentInfo> };

// Loads every non-voided transaction in the range with its spending effect attached.
// `parents` holds the category of every refunded/reversed original, wherever its date falls.
export async function loadAnalyzed(db: Executor, userId: string, range: Range): Promise<Analyzed> {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.voidedAt),
        gte(transactions.transactionDate, range.start),
        lt(transactions.transactionDate, range.endExclusive),
      ),
    );

  const parentIds = [...new Set(rows.map((r) => r.parentTransactionId).filter((p): p is string => !!p))];
  const parents = new Map<string, ParentInfo>();
  if (parentIds.length) {
    const ps = await db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, parentIds)));
    for (const p of ps) parents.set(p.id, { categoryId: p.categoryId });
  }

  const items = rows.map((r): AnalyzedTx => {
    const ledger: LedgerTransaction = {
      id: r.id,
      amountPaise: decimalToPaise(r.amount),
      currency: r.currency,
      direction: r.direction,
      type: r.transactionType,
      status: r.transactionStatus,
      categoryId: r.categoryId,
      parentTransactionId: r.parentTransactionId,
      voided: false,
    };
    const effect =
      r.currency === "INR" ? spendingEffect(ledger, r.parentTransactionId ? parents.get(r.parentTransactionId) : undefined) : null;
    return {
      id: r.id,
      date: r.transactionDate,
      merchant: r.merchantName ?? r.originalDescription,
      merchantKey: r.merchantNormalized,
      accountId: r.financialAccountId,
      paymentMethod: r.paymentMethod,
      paymentApp: r.paymentApp,
      type: r.transactionType,
      direction: r.direction,
      status: r.transactionStatus,
      amountPaise: ledger.amountPaise,
      currency: r.currency,
      effectPaise: effect?.amountPaise ?? 0,
      effectCategoryId: effect?.categoryId ?? null,
      captureMethod: r.captureMethod,
      isSample: r.isSample,
      ledger,
    };
  });
  return { items, parents };
}

// One summary per month from already-loaded rows, using the shared accounting.
export function summarizeMonths({ items, parents }: Analyzed, months: string[]) {
  return months.map((month) => ({
    month,
    ...summarize(items.filter((t) => t.date.startsWith(month)).map((t) => t.ledger), parents),
  }));
}

export async function earliestTransactionDate(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: min(transactions.transactionDate) })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.voidedAt)));
  return row?.first ?? null;
}

export async function lookups(db: Executor, userId: string) {
  const [cats, accounts] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.name)),
    db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.userId, userId))
      .orderBy(asc(financialAccounts.institutionName), asc(financialAccounts.accountName)),
  ]);
  return {
    categories: cats,
    accounts,
    categoryName: new Map(cats.map((c) => [c.id, c.name])),
    accountName: new Map(accounts.map((a) => [a.id, `${a.institutionName} ${a.accountName}${a.maskedIdentifier ? ` ••${a.maskedIdentifier}` : ""}`])),
  };
}

// Everything the overview page shows for one month.
export async function overview(db: Executor, userId: string, month: string, today = istDate(new Date())) {
  const { start, end } = monthRange(month);
  const historyStart = `${addMonths(month, -3)}-01`;
  const isCurrent = today.startsWith(month);
  const throughDay = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(month);
  const previousMonth = addMonths(month, -1);

  const [history, earliest, budgets, recentRows, reviewRows] = await Promise.all([
    loadAnalyzed(db, userId, { start: historyStart, endExclusive: end }),
    earliestTransactionDate(db, userId),
    budgetReport(db, userId, month),
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.voidedAt), gte(transactions.transactionDate, start), lt(transactions.transactionDate, end)))
      .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
      .limit(8),
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.voidedAt), eq(transactions.needsReview, true))),
  ]);

  const current = history.items.filter((t) => t.date >= start && t.date < end);
  const [thisSummary, prevSummary] = summarizeMonths(history, [month, previousMonth]);

  const refundsAndReversals = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.voidedAt),
        gte(transactions.transactionDate, start),
        lt(transactions.transactionDate, end),
        or(eq(transactions.transactionType, "refund"), eq(transactions.transactionType, "reversal")),
      ),
    )
    .orderBy(desc(transactions.transactionDate))
    .limit(5);

  return {
    month,
    isCurrent,
    throughDay,
    summary: thisSummary,
    previous: prevSummary,
    // Same days of the previous month, so a part-month is compared fairly.
    previousSameDaysPaise: cumulativeByDay(history.items, previousMonth)[Math.min(throughDay, daysInMonth(previousMonth)) - 1] ?? 0,
    cumulative: {
      current: cumulativeByDay(current, month).slice(0, throughDay),
      previous: cumulativeByDay(history.items, previousMonth),
    },
    byCategory: groupSpending(current, (t) => t.effectCategoryId, "uncategorized"),
    topMerchants: groupSpending(current, (t) => t.merchantKey, "Unknown merchant").slice(0, 5),
    merchantDisplay: new Map(current.filter((t) => t.merchantKey).map((t) => [t.merchantKey!, t.merchant ?? t.merchantKey!])),
    byPaymentMethod: groupSpending(current, (t) => t.paymentMethod),
    weekdays: weekdayPattern(current, start, isCurrent ? today : `${month}-${String(daysInMonth(month)).padStart(2, "0")}`),
    recent: recentRows.map(toDto),
    refundsAndReversals: refundsAndReversals.map(toDto),
    needsReviewCount: reviewRows.length,
    sampleCount: current.filter((t) => t.isSample).length,
    captureMethods: countBy(current, (t) => t.captureMethod),
    budgets,
    insights: unusualSpending(history.items, month, throughDay, earliest),
  };
}

function countBy<T>(items: T[], keyOf: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) out[keyOf(t)] = (out[keyOf(t)] ?? 0) + 1;
  return out;
}

// Suggested limits from the three complete months before `month`. Never saved automatically.
export async function budgetSuggestions(db: Executor, userId: string, month: string) {
  const [history, earliest] = await Promise.all([
    loadAnalyzed(db, userId, { start: `${addMonths(month, -3)}-01`, endExclusive: `${month}-01` }),
    earliestTransactionDate(db, userId),
  ]);
  return suggestBudgets(history.items, month, earliest);
}

// Data for the reports page over an arbitrary date range, plus six months of history.
export async function reports(db: Executor, userId: string, range: { from: string; to: string }, today = istDate(new Date())) {
  const toExclusive = new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const lastMonth = range.to.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(lastMonth, i - 5));
  const historyStart = `${months[0]}-01`;

  const [inRange, history, earliest] = await Promise.all([
    loadAnalyzed(db, userId, { start: range.from, endExclusive: toExclusive }),
    loadAnalyzed(db, userId, { start: historyStart < range.from ? historyStart : range.from, endExclusive: monthRange(lastMonth).end }),
    earliestTransactionDate(db, userId),
  ]);
  const isCurrent = today.startsWith(lastMonth);

  return {
    range,
    items: inRange.items,
    monthly: summarizeMonths(history, months),
    recurring: detectRecurring(history.items.filter((t) => t.date >= historyStart), months.length),
    insights: unusualSpending(history.items, lastMonth, isCurrent ? Number(today.slice(8, 10)) : daysInMonth(lastMonth), earliest),
    budgetSuggestions: suggestBudgets(history.items, lastMonth, earliest),
    earliest,
  };
}
