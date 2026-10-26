import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { monthRange, addDays, isValidDate } from "@/lib/dates";
import {
  ALLOWED_DIRECTIONS,
  CAPTURE_METHODS,
  DIRECTIONS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type CaptureMethod,
  type TransactionType,
} from "@/lib/finance-types";
import { decimalToPaise, paiseToDecimal } from "@/lib/money";
import { recordAudit } from "@/server/audit";
import type { Database } from "@/server/db/client";
import { auditEvents, financialAccounts, transactions } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import { summarize, type LedgerTransaction, type ParentInfo, type PeriodSummary } from "./accounting";
import { assertCategoryOwned, getSystemCategoryId } from "./categories-service";
import type { Executor } from "./db-types";
import {
  findTransferCounterpart,
  pickConfident,
  REFUND_LOOKBACK_DAYS,
  scoreRefundCandidates,
  TRANSFER_WINDOW_DAYS,
  type MatchableTransaction,
} from "./matching";
import { normalizeMerchant } from "./merchant";
import { matchCategoryRule } from "./rules";
import { loadActiveRules, upsertRule } from "./rules-service";

type Row = typeof transactions.$inferSelect;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export type TransactionDto = ReturnType<typeof toDto>;

export function toDto(r: Row) {
  return {
    id: r.id,
    financialAccountId: r.financialAccountId,
    transactionDate: r.transactionDate,
    sourceTimestamp: r.sourceTimestamp?.toISOString() ?? null,
    capturedAt: r.createdAt.toISOString(),
    merchantName: r.merchantName,
    originalDescription: r.originalDescription,
    amountPaise: decimalToPaise(r.amount),
    currency: r.currency,
    direction: r.direction,
    transactionType: r.transactionType,
    transactionStatus: r.transactionStatus,
    categoryId: r.categoryId,
    categorySource: r.categorySource,
    paymentMethod: r.paymentMethod,
    paymentApp: r.paymentApp,
    referenceId: r.referenceId,
    parentTransactionId: r.parentTransactionId,
    transferGroupId: r.transferGroupId,
    captureMethod: r.captureMethod,
    needsReview: r.needsReview,
    reviewReason: r.reviewReason,
    notes: r.notes,
    isSample: r.isSample,
    voidedAt: r.voidedAt?.toISOString() ?? null,
  };
}

function toLedger(r: Row): LedgerTransaction {
  return {
    id: r.id,
    amountPaise: decimalToPaise(r.amount),
    currency: r.currency,
    direction: r.direction,
    type: r.transactionType,
    status: r.transactionStatus,
    categoryId: r.categoryId,
    parentTransactionId: r.parentTransactionId,
    voided: r.voidedAt !== null,
  };
}

function toMatchable(r: Row): MatchableTransaction {
  return {
    id: r.id,
    financialAccountId: r.financialAccountId,
    transactionDate: r.transactionDate,
    amountPaise: decimalToPaise(r.amount),
    direction: r.direction,
    type: r.transactionType,
    status: r.transactionStatus,
    merchantNormalized: r.merchantNormalized,
    transferGroupId: r.transferGroupId,
    voided: r.voidedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
// For corrections: absent means "leave unchanged", while null or "" means "clear it".
const patchText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

export const createTransactionSchema = z.object({
  financialAccountId: z.string().uuid().nullish(),
  transactionDate: z.string().refine(isValidDate, "Use YYYY-MM-DD"),
  sourceTimestamp: z.coerce.date().nullish(),
  merchantName: optionalText(200),
  originalDescription: optionalText(1000),
  amountPaise: z.number().int().positive().max(99_999_999_999_999),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  direction: z.enum(DIRECTIONS),
  transactionType: z.enum(TRANSACTION_TYPES),
  transactionStatus: z.enum(TRANSACTION_STATUSES).exclude(["reversed"]).default("posted"),
  categoryId: z.string().uuid().nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).default("unknown"),
  paymentApp: optionalText(60),
  referenceId: optionalText(100),
  deduplicationKey: optionalText(200),
  notes: optionalText(2000),
});
export type CreateTransactionInput = z.input<typeof createTransactionSchema>;

export function assertTypeDirection(type: TransactionType, direction: "debit" | "credit") {
  if (!ALLOWED_DIRECTIONS[type].includes(direction)) {
    throw new DomainError("invalid_direction", `A ${type.replace("_", " ")} must be a ${ALLOWED_DIRECTIONS[type].join(" or ")}.`);
  }
}

async function assertAccountOwned(db: Executor, userId: string, accountId: string) {
  const [row] = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId)));
  if (!row) throw new NotFoundError("Account");
}

const SPENDING_TYPES: TransactionType[] = ["purchase", "fee"];

// The single entry point for new transactions, used by manual entry, the sample seed and
// (from Milestone 4) every automatic capture source. Re-submitting the same deduplication
// key returns the existing transaction instead of creating a second one.
export async function createTransaction(
  db: Database,
  userId: string,
  rawInput: CreateTransactionInput,
  origin: { captureMethod: CaptureMethod; isSample?: boolean; reviewReasons?: string[] },
): Promise<{ transaction: TransactionDto; created: boolean }> {
  if (!CAPTURE_METHODS.includes(origin.captureMethod)) throw new Error("Unknown capture method");
  const input = createTransactionSchema.parse(rawInput);
  assertTypeDirection(input.transactionType, input.direction);

  return db.transaction(async (tx) => {
    if (input.deduplicationKey) {
      const [existing] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.deduplicationKey, input.deduplicationKey)));
      if (existing) return { transaction: toDto(existing), created: false };
    }
    if (input.financialAccountId) await assertAccountOwned(tx, userId, input.financialAccountId);
    if (input.categoryId) await assertCategoryOwned(tx, userId, input.categoryId);

    const merchantNormalized = normalizeMerchant(input.merchantName ?? input.originalDescription);
    const reviewReasons: string[] = [...(origin.reviewReasons ?? [])];

    // Category: explicit choice, then the user's rules, then a type default.
    let categoryId = input.categoryId ?? null;
    let categorySource: "user" | "rule" | "type_default" | null = categoryId ? "user" : null;
    if (!categoryId && (SPENDING_TYPES.includes(input.transactionType) || input.transactionType === "refund")) {
      const rule = matchCategoryRule(await loadActiveRules(tx, userId), {
        merchantNormalized,
        originalDescription: input.originalDescription,
      });
      if (rule) {
        categoryId = rule.categoryId;
        categorySource = "rule";
      }
    }
    if (!categoryId && input.transactionType === "investment") {
      categoryId = await getSystemCategoryId(tx, userId, "investments");
      categorySource = categoryId ? "type_default" : null;
    }
    // A failed payment never counts as spending, so it doesn't need a category.
    if (!categoryId && SPENDING_TYPES.includes(input.transactionType) && input.transactionStatus !== "failed") {
      reviewReasons.push("uncategorized");
    }
    if (!input.financialAccountId) reviewReasons.push("account unknown");
    if (input.currency !== "INR") reviewReasons.push("foreign currency is not included in INR totals");

    const [row] = await tx
      .insert(transactions)
      .values({
        userId,
        financialAccountId: input.financialAccountId ?? null,
        transactionDate: input.transactionDate,
        sourceTimestamp: input.sourceTimestamp ?? null,
        merchantName: input.merchantName,
        merchantNormalized,
        originalDescription: input.originalDescription,
        amount: paiseToDecimal(input.amountPaise),
        currency: input.currency,
        direction: input.direction,
        transactionType: input.transactionType,
        transactionStatus: input.transactionStatus,
        categoryId,
        categorySource,
        paymentMethod: input.paymentMethod,
        paymentApp: input.paymentApp,
        referenceId: input.referenceId,
        deduplicationKey: input.deduplicationKey,
        captureMethod: origin.captureMethod,
        notes: input.notes,
        isSample: origin.isSample ?? false,
        needsReview: reviewReasons.length > 0,
        reviewReason: reviewReasons.join("; ") || null,
      })
      .returning();

    await recordAudit(tx, {
      userId,
      entityType: "transaction",
      entityId: row.id,
      action: "create",
      metadata: { captureMethod: origin.captureMethod, type: row.transactionType },
    });

    let result = row;
    if (row.transactionType === "refund" || row.transactionType === "reversal") {
      result = await autoLinkUndo(tx, userId, row);
    } else if (row.transactionType === "internal_transfer" || row.transactionType === "card_settlement") {
      result = await autoPairTransfer(tx, userId, row);
    }
    return { transaction: toDto(result), created: true };
  });
}

// Links a new refund/reversal to its original only when one candidate is clearly the match.
async function autoLinkUndo(tx: Executor, userId: string, row: Row): Promise<Row> {
  let candidates = await refundCandidates(tx, userId, row);
  // A reversal undoes the whole payment, so only exact-amount originals qualify.
  if (row.transactionType === "reversal") {
    candidates = candidates.filter((c) => c.amountPaise === decimalToPaise(row.amount));
  }
  const best = pickConfident(scoreRefundCandidates(toMatchable(row), candidates));
  if (best) {
    return row.transactionType === "refund"
      ? linkRefundIn(tx, userId, row.id, best.id, "auto")
      : linkReversalIn(tx, userId, row.id, best.id, "auto");
  }
  return markReview(tx, row, `${row.transactionType} not linked to its original transaction`);
}

// Pairs a transaction that a source already identified as a transfer/settlement with its other side.
async function autoPairTransfer(tx: Executor, userId: string, row: Row): Promise<Row> {
  if (!row.financialAccountId) return markReview(tx, row, "transfer side not matched");
  const amount = row.amount;
  const window = [addDays(row.transactionDate, -TRANSFER_WINDOW_DAYS), addDays(row.transactionDate, TRANSFER_WINDOW_DAYS)];
  const candidates = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.amount, amount),
        ne(transactions.id, row.id),
        isNull(transactions.voidedAt),
        isNull(transactions.transferGroupId),
        gte(transactions.transactionDate, window[0]),
        lte(transactions.transactionDate, window[1]),
      ),
    );
  const accounts = await accountTypes(tx, userId);
  const match = findTransferCounterpart(toMatchable(row), candidates.map(toMatchable), accounts);
  if (!match) return markReview(tx, row, "transfer side not matched");
  await linkTransferIn(tx, userId, row.id, match.counterpartId, "auto");
  return (await getRow(tx, userId, row.id))!;
}

async function markReview(tx: Executor, row: Row, reason: string): Promise<Row> {
  const reasons = [row.reviewReason, reason].filter(Boolean).join("; ");
  const [updated] = await tx
    .update(transactions)
    .set({ needsReview: true, reviewReason: reasons, updatedAt: new Date() })
    .where(eq(transactions.id, row.id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function getRow(db: Executor, userId: string, id: string): Promise<Row | undefined> {
  const [row] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  return row;
}

async function requireRow(db: Executor, userId: string, id: string): Promise<Row> {
  const row = await getRow(db, userId, id);
  if (!row) throw new NotFoundError("Transaction");
  return row;
}

async function accountTypes(db: Executor, userId: string) {
  const rows = await db
    .select({ id: financialAccounts.id, type: financialAccounts.accountType })
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, userId));
  return new Map(rows.map((r) => [r.id, r.type]));
}

export async function getTransaction(db: Executor, userId: string, id: string) {
  const row = await requireRow(db, userId, id);
  const related = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        or(
          eq(transactions.parentTransactionId, row.id),
          row.parentTransactionId ? eq(transactions.id, row.parentTransactionId) : sql`false`,
          row.transferGroupId ? and(eq(transactions.transferGroupId, row.transferGroupId), ne(transactions.id, row.id)) : sql`false`,
        ),
      ),
    );
  const parent = related.find((r) => r.id === row.parentTransactionId);
  const counterpart = row.transferGroupId ? related.find((r) => r.transferGroupId === row.transferGroupId) : undefined;
  return {
    transaction: toDto(row),
    parent: parent ? toDto(parent) : null,
    children: related.filter((r) => r.parentTransactionId === row.id).map(toDto),
    transferCounterpart: counterpart ? toDto(counterpart) : null,
  };
}

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item).max(50)).optional();
const bool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();

export const listFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().refine(isValidDate, "Use YYYY-MM-DD").optional(),
  to: z.string().refine(isValidDate, "Use YYYY-MM-DD").optional(),
  categoryIds: csv(z.string().uuid()),
  uncategorized: bool,
  accountIds: csv(z.string().uuid()),
  paymentMethods: csv(z.enum(PAYMENT_METHODS)),
  paymentApps: csv(z.string().max(60)),
  types: csv(z.enum(TRANSACTION_TYPES)),
  statuses: csv(z.enum(TRANSACTION_STATUSES)),
  captureMethods: csv(z.enum(CAPTURE_METHODS)),
  minAmountPaise: z.coerce.number().int().nonnegative().optional(),
  maxAmountPaise: z.coerce.number().int().nonnegative().optional(),
  needsReview: bool,
  includeVoided: bool,
  sort: z.enum(["date", "amount"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListFilter = z.input<typeof listFilterSchema>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function filterCondition(userId: string, f: z.output<typeof listFilterSchema>) {
  const where: SQL[] = [eq(transactions.userId, userId)];
  if (!f.includeVoided) where.push(isNull(transactions.voidedAt));
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`;
    where.push(or(ilike(transactions.merchantName, pattern), ilike(transactions.originalDescription, pattern))!);
  }
  if (f.from) where.push(gte(transactions.transactionDate, f.from));
  if (f.to) where.push(lte(transactions.transactionDate, f.to));
  if (f.categoryIds?.length || f.uncategorized) {
    where.push(
      or(
        f.categoryIds?.length ? inArray(transactions.categoryId, f.categoryIds) : sql`false`,
        f.uncategorized ? isNull(transactions.categoryId) : sql`false`,
      )!,
    );
  }
  if (f.accountIds?.length) where.push(inArray(transactions.financialAccountId, f.accountIds));
  if (f.paymentMethods?.length) where.push(inArray(transactions.paymentMethod, f.paymentMethods));
  if (f.paymentApps?.length) where.push(inArray(transactions.paymentApp, f.paymentApps));
  if (f.types?.length) where.push(inArray(transactions.transactionType, f.types));
  if (f.statuses?.length) where.push(inArray(transactions.transactionStatus, f.statuses));
  if (f.captureMethods?.length) where.push(inArray(transactions.captureMethod, f.captureMethods));
  if (f.minAmountPaise !== undefined) where.push(gte(transactions.amount, paiseToDecimal(f.minAmountPaise)));
  if (f.maxAmountPaise !== undefined) where.push(lte(transactions.amount, paiseToDecimal(f.maxAmountPaise)));
  if (f.needsReview !== undefined) where.push(eq(transactions.needsReview, f.needsReview));
  return and(...where);
}

// Stable tie-breakers so pages never overlap.
function filterOrder(f: z.output<typeof listFilterSchema>) {
  const direction = f.order === "asc" ? asc : desc;
  const primary = f.sort === "amount" ? direction(transactions.amount) : direction(transactions.transactionDate);
  return [primary, direction(transactions.createdAt), asc(transactions.id)];
}

export async function listTransactions(db: Executor, userId: string, rawFilter: ListFilter) {
  const f = listFilterSchema.parse(rawFilter);
  const condition = filterCondition(userId, f);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(condition)
      .orderBy(...filterOrder(f))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ total: count() }).from(transactions).where(condition),
  ]);
  return { items: rows.map(toDto), total, page: f.page, pageSize: f.pageSize };
}

export const EXPORT_ROW_LIMIT = 100_000;

// Every transaction matching the filter (paging ignored), for exports and the Sheets sync.
export async function allMatchingTransactions(db: Executor, userId: string, rawFilter: Omit<ListFilter, "page" | "pageSize">) {
  const f = listFilterSchema.parse(rawFilter);
  const rows = await db
    .select()
    .from(transactions)
    .where(filterCondition(userId, f))
    .orderBy(...filterOrder(f))
    .limit(EXPORT_ROW_LIMIT + 1);
  if (rows.length > EXPORT_ROW_LIMIT) throw new DomainError("too_many_rows", `More than ${EXPORT_ROW_LIMIT} transactions match. Narrow the date range.`);
  return rows.map(toDto);
}

// ---------------------------------------------------------------------------
// Corrections (always audited; history is never erased)
// ---------------------------------------------------------------------------

export const correctionSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    merchantName: patchText(200),
    transactionType: z.enum(TRANSACTION_TYPES).optional(),
    transactionDate: z.string().refine(isValidDate, "Use YYYY-MM-DD").optional(),
    amountPaise: z.number().int().positive().max(99_999_999_999_999).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paymentApp: patchText(60),
    financialAccountId: z.string().uuid().nullable().optional(),
    notes: patchText(2000),
    markReviewed: z.boolean().optional(),
    // Explicit opt-in: future transactions from this merchant get the same category.
    createRule: z.boolean().optional(),
  })
  .strict();
export type CorrectionInput = z.input<typeof correctionSchema>;

export async function correctTransaction(db: Database, userId: string, id: string, rawPatch: CorrectionInput) {
  const patch = correctionSchema.parse(rawPatch);
  return db.transaction(async (tx) => {
    const before = await requireRow(tx, userId, id);
    if (before.voidedAt) throw new DomainError("voided", "A voided transaction can't be changed.");

    const type = patch.transactionType ?? before.transactionType;
    if (type !== before.transactionType && (before.parentTransactionId || before.transferGroupId)) {
      throw new DomainError("linked", "Unlink this transaction before changing its type.");
    }
    if (patch.amountPaise !== undefined && (before.transferGroupId || before.parentTransactionId)) {
      throw new DomainError("linked", "Unlink this transaction before changing its amount.");
    }
    assertTypeDirection(type, before.direction);
    if (patch.categoryId) await assertCategoryOwned(tx, userId, patch.categoryId);
    if (patch.financialAccountId) await assertAccountOwned(tx, userId, patch.financialAccountId);

    const merchantName = patch.merchantName !== undefined ? patch.merchantName : before.merchantName;
    const update: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
    if (patch.categoryId !== undefined) {
      update.categoryId = patch.categoryId;
      update.categorySource = patch.categoryId ? "user" : null;
    }
    if (patch.merchantName !== undefined) {
      update.merchantName = merchantName;
      update.merchantNormalized = normalizeMerchant(merchantName ?? before.originalDescription);
    }
    if (patch.transactionType) update.transactionType = patch.transactionType;
    if (patch.transactionDate) update.transactionDate = patch.transactionDate;
    if (patch.amountPaise !== undefined) update.amount = paiseToDecimal(patch.amountPaise);
    if (patch.paymentMethod) update.paymentMethod = patch.paymentMethod;
    if (patch.paymentApp !== undefined) update.paymentApp = patch.paymentApp;
    if (patch.financialAccountId !== undefined) update.financialAccountId = patch.financialAccountId;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.markReviewed) {
      update.needsReview = false;
      update.reviewReason = null;
    }

    const [after] = await tx.update(transactions).set(update).where(eq(transactions.id, id)).returning();

    const changed = Object.keys(update).filter((k) => k !== "updatedAt" && k !== "merchantNormalized");
    const snapshot = (r: Row) => ({
      categoryId: r.categoryId,
      transactionType: r.transactionType,
      transactionDate: r.transactionDate,
      amount: r.amount,
      paymentMethod: r.paymentMethod,
      financialAccountId: r.financialAccountId,
      merchantName: r.merchantName,
      needsReview: r.needsReview,
    });
    await recordAudit(tx, {
      userId,
      entityType: "transaction",
      entityId: id,
      action: "correct",
      metadata: {
        changed: changed.join(","),
        before: JSON.stringify(snapshot(before)),
        after: JSON.stringify(snapshot(after)),
      },
    });

    let rule = null;
    if (patch.createRule) {
      if (!after.categoryId) throw new DomainError("rule_needs_category", "Choose a category before creating a rule.");
      if (!after.merchantNormalized) throw new DomainError("rule_needs_merchant", "This transaction has no merchant to match on.");
      rule = await upsertRule(tx, userId, {
        matchType: "merchant_exact",
        matchValue: after.merchantNormalized,
        categoryId: after.categoryId,
      });
    }
    return { transaction: toDto(after), ruleId: rule?.id ?? null };
  });
}

export async function voidTransaction(db: Database, userId: string, id: string, reason: string) {
  return db.transaction(async (tx) => {
    const row = await requireRow(tx, userId, id);
    if (row.voidedAt) return toDto(row);
    if (row.transferGroupId) throw new DomainError("linked", "Unlink the transfer before voiding.");
    const [child] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.parentTransactionId, id), isNull(transactions.voidedAt)));
    if (child) throw new DomainError("linked", "This transaction has a linked refund or reversal. Unlink it first.");
    if (row.parentTransactionId) await unlinkIn(tx, userId, row);

    const [after] = await tx
      .update(transactions)
      .set({ voidedAt: new Date(), updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    await recordAudit(tx, {
      userId,
      entityType: "transaction",
      entityId: id,
      action: "void",
      metadata: { reason: reason.slice(0, 200) },
    });
    return toDto(after);
  });
}

// ---------------------------------------------------------------------------
// Links: refunds, reversals, own-account transfers and card settlements
// ---------------------------------------------------------------------------

async function refundCandidates(db: Executor, userId: string, undo: Row) {
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.direction, "debit"),
        inArray(transactions.transactionType, ["purchase", "fee"]),
        isNull(transactions.voidedAt),
        gte(transactions.transactionDate, addDays(undo.transactionDate, -REFUND_LOOKBACK_DAYS)),
        lte(transactions.transactionDate, undo.transactionDate),
      ),
    );
  const refunded = await refundedTotals(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...toMatchable(r),
    remainingPaise: decimalToPaise(r.amount) - (refunded.get(r.id) ?? 0),
  }));
}

async function refundedTotals(db: Executor, parentIds: string[]): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await db
    .select({ parentId: transactions.parentTransactionId, total: sql<string>`sum(${transactions.amount})` })
    .from(transactions)
    .where(
      and(
        inArray(transactions.parentTransactionId, parentIds),
        eq(transactions.transactionType, "refund"),
        isNull(transactions.voidedAt),
      ),
    )
    .groupBy(transactions.parentTransactionId);
  return new Map(rows.map((r) => [r.parentId!, decimalToPaise(r.total)]));
}

async function linkRefundIn(tx: Executor, userId: string, refundId: string, originalId: string, how: "auto" | "user") {
  const refund = await requireRow(tx, userId, refundId);
  const original = await requireRow(tx, userId, originalId);
  if (refund.transactionType !== "refund") throw new DomainError("not_refund", "Only a refund can be linked this way.");
  if (refund.parentTransactionId) throw new DomainError("already_linked", "This refund is already linked.");
  if (original.direction !== "debit" || !["purchase", "fee"].includes(original.transactionType)) {
    throw new DomainError("bad_original", "A refund can only be linked to a purchase or fee.");
  }
  if (refund.voidedAt || original.voidedAt) throw new DomainError("voided", "Voided transactions can't be linked.");
  const already = (await refundedTotals(tx, [original.id])).get(original.id) ?? 0;
  if (already + decimalToPaise(refund.amount) > decimalToPaise(original.amount)) {
    throw new DomainError("over_refund", "Refunds would exceed the original amount.");
  }

  const [after] = await tx
    .update(transactions)
    .set({
      parentTransactionId: original.id,
      // Shown under the original's category; the accounting uses the parent's category anyway.
      categoryId: original.categoryId,
      categorySource: original.categorySource,
      needsReview: false,
      reviewReason: null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, refund.id))
    .returning();
  await recordAudit(tx, {
    userId,
    entityType: "transaction",
    entityId: refund.id,
    action: "link_refund",
    metadata: { parentId: original.id, how },
  });
  return after;
}

async function linkReversalIn(tx: Executor, userId: string, reversalId: string, originalId: string, how: "auto" | "user") {
  const reversal = await requireRow(tx, userId, reversalId);
  const original = await requireRow(tx, userId, originalId);
  if (reversal.transactionType !== "reversal") throw new DomainError("not_reversal", "Only a reversal can be linked this way.");
  if (reversal.parentTransactionId) throw new DomainError("already_linked", "This reversal is already linked.");
  if (original.direction !== "debit") throw new DomainError("bad_original", "A reversal can only undo a debit.");
  if (original.transactionStatus === "reversed") throw new DomainError("already_reversed", "That transaction is already reversed.");
  if (original.transactionStatus === "failed") throw new DomainError("failed_original", "A failed payment needs no reversal.");
  if (reversal.amount !== original.amount) {
    throw new DomainError("partial_reversal", "A reversal must match the full amount. Record a partial return as a refund.");
  }
  if (original.transferGroupId) throw new DomainError("linked", "Unlink the transfer before reversing it.");

  await tx
    .update(transactions)
    .set({ transactionStatus: "reversed", updatedAt: new Date() })
    .where(eq(transactions.id, original.id));
  const [after] = await tx
    .update(transactions)
    .set({ parentTransactionId: original.id, needsReview: false, reviewReason: null, updatedAt: new Date() })
    .where(eq(transactions.id, reversal.id))
    .returning();
  await recordAudit(tx, {
    userId,
    entityType: "transaction",
    entityId: reversal.id,
    action: "link_reversal",
    metadata: { parentId: original.id, how, parentPreviousStatus: original.transactionStatus },
  });
  return after;
}

async function linkTransferIn(tx: Executor, userId: string, aId: string, bId: string, how: "auto" | "user") {
  if (aId === bId) throw new DomainError("same_transaction", "Pick two different transactions.");
  const a = await requireRow(tx, userId, aId);
  const b = await requireRow(tx, userId, bId);
  for (const r of [a, b]) {
    if (r.voidedAt) throw new DomainError("voided", "Voided transactions can't be linked.");
    if (r.transferGroupId || r.parentTransactionId) throw new DomainError("already_linked", "One of these is already linked.");
    if (r.transactionStatus === "failed" || r.transactionStatus === "reversed") {
      throw new DomainError("not_completed", "Only completed transactions can be paired.");
    }
    if (!r.financialAccountId) throw new DomainError("account_unknown", "Both sides need a known account.");
  }
  if (a.direction === b.direction) throw new DomainError("same_direction", "A transfer needs one debit and one credit.");
  if (a.amount !== b.amount) throw new DomainError("amount_mismatch", "Both sides of a transfer must have the same amount.");
  if (a.financialAccountId === b.financialAccountId) throw new DomainError("same_account", "Both sides are on the same account.");

  const types = await accountTypes(tx, userId);
  const credit = a.direction === "credit" ? a : b;
  const kind = types.get(credit.financialAccountId!) === "credit_card" ? "card_settlement" : "internal_transfer";
  const groupId = randomUUID();

  for (const r of [a, b]) {
    await tx
      .update(transactions)
      .set({
        transactionType: kind,
        transferGroupId: groupId,
        categoryId: null,
        categorySource: null,
        needsReview: false,
        reviewReason: null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, r.id));
    await recordAudit(tx, {
      userId,
      entityType: "transaction",
      entityId: r.id,
      action: "link_transfer",
      metadata: { groupId, kind, how, previousType: r.transactionType },
    });
  }
  return { groupId, kind };
}

async function unlinkIn(tx: Executor, userId: string, row: Row) {
  if (row.parentTransactionId) {
    if (row.transactionType === "reversal") {
      // Restore the original; its pre-reversal status is in the audit trail, and a reversal
      // can only be linked to a pending or posted transaction.
      await tx
        .update(transactions)
        .set({ transactionStatus: "posted", updatedAt: new Date() })
        .where(and(eq(transactions.id, row.parentTransactionId), eq(transactions.transactionStatus, "reversed")));
    }
    await tx
      .update(transactions)
      .set({
        parentTransactionId: null,
        needsReview: true,
        reviewReason: `${row.transactionType} not linked to its original transaction`,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, row.id));
    await recordAudit(tx, { userId, entityType: "transaction", entityId: row.id, action: "unlink", metadata: { parentId: row.parentTransactionId } });
  } else if (row.transferGroupId) {
    const group = await tx.select().from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId));
    for (const r of group) {
      await tx
        .update(transactions)
        .set({ transferGroupId: null, needsReview: true, reviewReason: "transfer link removed; check the type", updatedAt: new Date() })
        .where(eq(transactions.id, r.id));
      await recordAudit(tx, { userId, entityType: "transaction", entityId: r.id, action: "unlink", metadata: { groupId: row.transferGroupId } });
    }
  } else {
    throw new DomainError("not_linked", "This transaction isn't linked to anything.");
  }
}

export async function linkRefund(db: Database, userId: string, refundId: string, originalId: string) {
  return db.transaction(async (tx) => toDto(await linkRefundIn(tx, userId, refundId, originalId, "user")));
}

export async function linkReversal(db: Database, userId: string, reversalId: string, originalId: string) {
  return db.transaction(async (tx) => toDto(await linkReversalIn(tx, userId, reversalId, originalId, "user")));
}

export async function linkTransfer(db: Database, userId: string, aId: string, bId: string) {
  return db.transaction((tx) => linkTransferIn(tx, userId, aId, bId, "user"));
}

export async function unlinkTransaction(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    await unlinkIn(tx, userId, await requireRow(tx, userId, id));
    return toDto(await requireRow(tx, userId, id));
  });
}

// Suggestions for the review screen. Nothing is changed, and the user decides.
export async function suggestLinks(db: Executor, userId: string, id: string) {
  const row = await requireRow(db, userId, id);
  const undo = row.transactionType === "refund" || row.transactionType === "reversal";
  const refunds = undo && !row.parentTransactionId ? scoreRefundCandidates(toMatchable(row), await refundCandidates(db, userId, row)) : [];

  // Possible other sides of an own-account transfer: same amount, opposite direction,
  // a different account of the user's, within a few days.
  let transferCandidates: Row[] = [];
  if (!undo && !row.transferGroupId && !row.parentTransactionId && row.financialAccountId && !row.voidedAt) {
    transferCandidates = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.amount, row.amount),
          ne(transactions.direction, row.direction),
          ne(transactions.financialAccountId, row.financialAccountId),
          isNull(transactions.voidedAt),
          isNull(transactions.transferGroupId),
          isNull(transactions.parentTransactionId),
          gte(transactions.transactionDate, addDays(row.transactionDate, -TRANSFER_WINDOW_DAYS)),
          lte(transactions.transactionDate, addDays(row.transactionDate, TRANSFER_WINDOW_DAYS)),
        ),
      )
      .limit(5);
  }

  const byId = refunds.length
    ? new Map((await db.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, refunds.map((r) => r.id))))).map((r) => [r.id, r]))
    : new Map<string, Row>();
  return {
    refundCandidates: refunds.slice(0, 5).map((c) => ({ ...c, transaction: toDto(byId.get(c.id)!) })),
    transferCandidates: transferCandidates.filter((c) => c.transactionStatus !== "failed" && c.transactionStatus !== "reversed").map(toDto),
  };
}

export async function transactionHistory(db: Executor, userId: string, id: string) {
  await requireRow(db, userId, id);
  return db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata, createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityType, "transaction"), eq(auditEvents.entityId, id)))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export async function summarizeRange(
  db: Executor,
  userId: string,
  range: { start: string; endExclusive: string },
): Promise<PeriodSummary & { sampleTransactionCount: number; needsReviewCount: number }> {
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
    const parentRows = await db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, parentIds)));
    for (const p of parentRows) parents.set(p.id, { categoryId: p.categoryId });
  }

  return {
    ...summarize(rows.map(toLedger), parents),
    sampleTransactionCount: rows.filter((r) => r.isSample).length,
    needsReviewCount: rows.filter((r) => r.needsReview).length,
  };
}

export async function summarizeMonth(db: Executor, userId: string, month: string) {
  const { start, end } = monthRange(month);
  return summarizeRange(db, userId, { start, endExclusive: end });
}
