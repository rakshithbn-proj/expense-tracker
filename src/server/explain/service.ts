import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { addDays, istDate } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/finance-types";
import { formatDate, formatInr } from "@/lib/format";
import { decimalToPaise } from "@/lib/money";
import { recordAudit } from "@/server/audit";
import type { Database } from "@/server/db/client";
import { categories, explainSettings, transactions } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import type { Executor } from "@/server/finance/db-types";
import { lookups } from "@/server/finance/reports-service";
import { correctTransaction } from "@/server/finance/transactions-service";

// "Explain" prompts: the user's iPhone asks them why each new payment was made and how to
// categorise it. The app keeps the schedule; the phone only asks "is anything due?" whenever
// a Shortcut automation fires (typically when the user opens an everyday app, i.e. after
// unlocking). See ADR-0009.

export type ExplainSettings = typeof explainSettings.$inferSelect;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const MAX_ITEMS_PER_PROMPT = 20;

// "09:00,12:00" -> minutes after midnight, sorted, unique. Throws a readable error otherwise.
export function parseSlotTimes(text: string): number[] {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 24) throw new DomainError("invalid_slots", "Enter between 1 and 24 times, like 09:00, 12:00, 15:00.");
  const minutes = parts.map((p) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(p);
    if (!m) throw new DomainError("invalid_slots", `"${p}" isn't a time. Use 24-hour HH:MM, like 18:00.`);
    return Number(m[1]) * 60 + Number(m[2]);
  });
  return [...new Set(minutes)].sort((a, b) => a - b);
}

export const formatSlotTimes = (minutes: number[]) =>
  minutes.map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`).join(", ");

// The latest slot (India time) at or before `now`, looking back into yesterday if needed.
export function lastSlotAtOrBefore(now: Date, slots: number[]): Date {
  const today = istDate(now);
  for (const day of [today, addDays(today, -1)]) {
    const midnight = Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS;
    const candidates = slots.map((m) => midnight + m * 60_000).filter((t) => t <= now.getTime());
    if (candidates.length) return new Date(Math.max(...candidates));
  }
  throw new Error("No slot times");
}

// Payments worth asking about: real spending debits not yet explained. Card bills, own-account
// transfers, income and the like aren't spending, so they're never asked about.
function askable(userId: string, askFrom: Date) {
  return and(
    eq(transactions.userId, userId),
    isNull(transactions.voidedAt),
    isNull(transactions.explainedAt),
    eq(transactions.isSample, false),
    eq(transactions.direction, "debit"),
    inArray(transactions.transactionType, ["purchase", "fee"]),
    notInArray(transactions.transactionStatus, ["failed", "reversed"]),
    gte(transactions.createdAt, askFrom),
  );
}

export async function getExplainSettings(db: Executor, userId: string, now = new Date()): Promise<ExplainSettings> {
  const [row] = await db.select().from(explainSettings).where(eq(explainSettings.userId, userId));
  if (row) return row;
  // First use: start asking from now, so earlier history isn't one enormous batch.
  const [created] = await db.insert(explainSettings).values({ userId, askFrom: now, updatedAt: now }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(explainSettings).where(eq(explainSettings.userId, userId)))[0];
}

export async function updateExplainSettings(
  db: Executor,
  userId: string,
  input: { enabled: boolean; slotTimes: string; retryMinutes: number },
  now = new Date(),
) {
  const slots = parseSlotTimes(input.slotTimes);
  if (!Number.isInteger(input.retryMinutes) || input.retryMinutes < 5 || input.retryMinutes > 180) {
    throw new DomainError("invalid_retry", "Ask again after 5 to 180 minutes.");
  }
  await getExplainSettings(db, userId, now);
  await db
    .update(explainSettings)
    .set({ enabled: input.enabled, slotTimes: formatSlotTimes(slots).replace(/ /g, ""), retryMinutes: input.retryMinutes, updatedAt: now })
    .where(eq(explainSettings.userId, userId));
  await recordAudit(db, { userId, entityType: "explain_settings", entityId: userId, action: "update", metadata: { enabled: input.enabled } });
}

export type ExplainItem = {
  id: string;
  amountPaise: number;
  merchant: string;
  account: string | null;
  method: string | null;
  when: Date;
  categoryId: string | null;
  categoryName: string | null;
  label: string;
};

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

const methodLabels: Partial<Record<PaymentMethod, string>> = {
  upi: "UPI",
  credit_card: "Card",
  debit_card: "Card",
  net_banking: "Net banking",
  auto_debit: "Auto-debit",
  cash: "Cash",
  wallet: "Wallet",
};

// "₹1,200.00 · AMAZON · UPI · ICICI Bank Savings ••1234 · Today 3:42 pm". The method is left
// out when the account name already says it ("HDFC Bank Card ••4321").
function describe(item: Omit<ExplainItem, "label">, now: Date): string {
  const day = istDate(item.when);
  const today = istDate(now);
  const dayLabel = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : formatDate(day);
  const method = item.method && !item.account?.toLowerCase().includes(item.method.toLowerCase()) ? item.method : null;
  return [formatInr(item.amountPaise), item.merchant, method, item.account, `${dayLabel} ${timeFmt.format(item.when)}`].filter(Boolean).join(" · ");
}

// Every payment waiting for an answer, oldest first.
export async function listToExplain(db: Executor, userId: string, now = new Date(), limit = 200): Promise<ExplainItem[]> {
  const settings = await getExplainSettings(db, userId, now);
  const [rows, names] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(askable(userId, settings.askFrom))
      .orderBy(asc(transactions.createdAt))
      .limit(limit),
    lookups(db, userId),
  ]);
  return rows.map((r) => {
    const base = {
      id: r.id,
      amountPaise: decimalToPaise(r.amount),
      merchant: r.merchantName ?? r.originalDescription?.slice(0, 60) ?? "Unknown payee",
      account: r.financialAccountId ? (names.accountName.get(r.financialAccountId) ?? null) : null,
      method: methodLabels[r.paymentMethod] ?? null,
      // When the payment happened if the source said, otherwise when it was captured.
      when: r.sourceTimestamp ?? r.createdAt,
      categoryId: r.categoryId,
      categoryName: r.categoryId ? (names.categoryName.get(r.categoryId) ?? null) : null,
    };
    return { ...base, label: describe(base, now) };
  });
}

export type DuePrompt = { title: string; items: (ExplainItem & { categories: string[] })[] };

// What the phone should ask right now, if anything. A batch is due once a slot time has
// passed since the oldest waiting payment was captured. Asking takes a lease for the retry
// interval: if the user skips or the prompt never shows (phone locked), it's due again after
// that. `manual` (the user ran the Shortcut by hand) ignores both the schedule and the lease.
export async function takeDuePrompt(db: Database, userId: string, now = new Date(), options: { manual?: boolean } = {}): Promise<DuePrompt | null> {
  const settings = await getExplainSettings(db, userId, now);
  if (!settings.enabled && !options.manual) return null;
  const waiting = await listToExplain(db, userId, now, MAX_ITEMS_PER_PROMPT);
  if (waiting.length === 0) return null;

  if (!options.manual) {
    const slot = lastSlotAtOrBefore(now, parseSlotTimes(settings.slotTimes));
    const oldestCaptured = (await db.select({ at: transactions.createdAt }).from(transactions).where(eq(transactions.id, waiting[0].id)))[0].at;
    if (oldestCaptured > slot) return null;
    // Atomic: when several automations fire at once, only one of them gets the batch.
    const leased = await db
      .update(explainSettings)
      .set({ promptLeaseUntil: new Date(now.getTime() + settings.retryMinutes * 60_000) })
      .where(and(eq(explainSettings.userId, userId), or(isNull(explainSettings.promptLeaseUntil), lte(explainSettings.promptLeaseUntil, now))))
      .returning({ userId: explainSettings.userId });
    if (leased.length === 0) return null;
  }

  const active = await db
    .select({ name: categories.name, systemKey: categories.systemKey })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.isActive, true)))
    .orderBy(asc(categories.name));
  // "Other / Uncategorized" last; the payment's current category (e.g. from a rule) first.
  const names = [...active.filter((c) => c.systemKey !== "uncategorized"), ...active.filter((c) => c.systemKey === "uncategorized")].map((c) => c.name);
  return {
    title: `${waiting.length} payment${waiting.length === 1 ? "" : "s"} to explain`,
    items: waiting.map((w) => ({ ...w, categories: w.categoryName ? [w.categoryName, ...names.filter((n) => n !== w.categoryName)] : names })),
  };
}

// Saves the user's answer: category (by id from the app, or by name from the Shortcut) and an
// optional reason. Uses the normal audited correction path; "remember" creates a merchant rule.
export async function explainTransaction(
  db: Database,
  userId: string,
  id: string,
  answer: { categoryId?: string; categoryName?: string; reason?: string | null; remember?: boolean },
) {
  const [row] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!row || row.voidedAt) throw new NotFoundError("Payment");

  let categoryId = answer.categoryId;
  if (!categoryId && answer.categoryName) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), sql`lower(${categories.name}) = lower(${answer.categoryName.trim()})`));
    if (!cat) throw new DomainError("unknown_category", `There's no category called "${answer.categoryName}".`);
    categoryId = cat.id;
  }
  if (!categoryId) throw new DomainError("category_required", "Choose a category.");

  const reason = answer.reason?.trim() || null;
  const result = await correctTransaction(db, userId, id, {
    categoryId,
    reason,
    markExplained: true,
    // Being uncategorised was the only thing to review, and it's now answered.
    markReviewed: row.reviewReason === "uncategorized" ? true : undefined,
    createRule: answer.remember && !!row.merchantNormalized ? true : undefined,
  });
  return result.transaction;
}
