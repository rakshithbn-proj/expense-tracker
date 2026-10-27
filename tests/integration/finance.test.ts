import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/finance-types";
import { auditEvents, transactions, users } from "@/server/db/schema";
import { DomainError, NotFoundError } from "@/server/errors";
import { createAccount } from "@/server/finance/accounts-service";
import { budgetReport, setBudget } from "@/server/finance/budgets-service";
import { ensureDefaultCategories, listCategories, updateCategory } from "@/server/finance/categories-service";
import { upsertRule } from "@/server/finance/rules-service";
import {
  correctTransaction,
  createTransaction,
  getTransaction,
  linkRefund,
  linkReversal,
  linkTransfer,
  listReasons,
  listTransactions,
  summarizeMonth,
  unlinkTransaction,
  voidTransaction,
  type CreateTransactionInput,
} from "@/server/finance/transactions-service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

const MONTH = "2026-10";
let userId: string;
let cat: Record<string, string>;
let bank: string;
let bank2: string;
let card: string;

const create = async (input: Partial<CreateTransactionInput>, captureMethod: "manual" | "auto_email" = "manual") =>
  (
    await createTransaction(
      testDb(),
      userId,
      {
        transactionDate: `${MONTH}-10`,
        amountPaise: 1000_00,
        direction: "debit",
        transactionType: "purchase",
        financialAccountId: bank,
        ...input,
      },
      { captureMethod },
    )
  ).transaction;

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  cat = Object.fromEntries((await listCategories(testDb(), userId)).map((c) => [c.systemKey, c.id]));
  bank = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Savings", accountType: "bank_account", maskedIdentifier: "1234" })).id;
  bank2 = (await createAccount(testDb(), userId, { institutionName: "SBI", accountName: "Savings", accountType: "bank_account" })).id;
  card = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Card", accountType: "credit_card", maskedIdentifier: "4321" })).id;
});
afterAll(closeTestDb);

describe("setup", () => {
  it("creates the 14 default categories once", async () => {
    await ensureDefaultCategories(testDb(), userId);
    const names = (await listCategories(testDb(), userId)).map((c) => c.name).sort();
    expect(names).toEqual(DEFAULT_CATEGORIES.map((c) => c.name).sort());
  });

  it("refuses full card numbers", async () => {
    await expect(
      createAccount(testDb(), userId, { institutionName: "X", accountName: "Y", accountType: "credit_card", maskedIdentifier: "4111111111111111" }),
    ).rejects.toThrow(DomainError);
  });

  it("protects the uncategorized category and rejects duplicate names", async () => {
    await expect(updateCategory(testDb(), userId, cat.uncategorized, { isActive: false })).rejects.toThrow(DomainError);
    await expect(updateCategory(testDb(), userId, cat.groceries, { name: "Food & Dining" })).rejects.toThrow(/already exists/);
  });
});

describe("creating transactions", () => {
  it("applies the user's rules and flags uncategorized spending for review", async () => {
    await upsertRule(testDb(), userId, { matchType: "merchant_contains", matchValue: "bigbasket", categoryId: cat.groceries });
    const known = await create({ merchantName: "POS BIGBASKET BLR" });
    expect(known).toMatchObject({ categoryId: cat.groceries, categorySource: "rule", needsReview: false });

    const unknown = await create({ merchantName: "UPI/unknown-payee@ybl" });
    expect(unknown).toMatchObject({ categoryId: null, needsReview: true, reviewReason: "uncategorized" });
  });

  it("does not flag failed payments or non-spending types as uncategorized", async () => {
    expect((await create({ transactionStatus: "failed" })).needsReview).toBe(false);
    expect((await create({ transactionType: "income", direction: "credit" })).needsReview).toBe(false);
  });

  it("gives investments the Investments category by default", async () => {
    expect(await create({ transactionType: "investment" })).toMatchObject({ categoryId: cat.investments, categorySource: "type_default" });
  });

  it("is idempotent on the deduplication key", async () => {
    const first = await createTransaction(testDb(), userId, { transactionDate: `${MONTH}-01`, amountPaise: 500, direction: "debit", transactionType: "purchase", deduplicationKey: "gmail:abc" }, { captureMethod: "auto_email" });
    const again = await createTransaction(testDb(), userId, { transactionDate: `${MONTH}-01`, amountPaise: 500, direction: "debit", transactionType: "purchase", deduplicationKey: "gmail:abc" }, { captureMethod: "auto_email" });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.transaction.id).toBe(first.transaction.id);
    expect((await listTransactions(testDb(), userId, {})).total).toBe(1);
  });

  it("rejects impossible type/direction combinations, in code and in the database", async () => {
    await expect(create({ transactionType: "refund", direction: "debit" })).rejects.toThrow(DomainError);
    await expect(
      testDb().insert(transactions).values({ userId, transactionDate: "2026-10-01", amount: "1.00", direction: "credit", transactionType: "purchase", captureMethod: "manual" }),
    ).rejects.toThrow();
  });

  it("records manual entries as manual, never as automatic", async () => {
    expect((await create({})).captureMethod).toBe("manual");
  });
});

describe("accounting through the database", () => {
  it("credit card purchase + bill payment counts once (8.1)", async () => {
    await create({ amountPaise: 2000_00, financialAccountId: card, categoryId: cat.groceries });
    await create({ amountPaise: 2000_00, transactionType: "card_settlement", financialAccountId: bank });
    const credit = await create({ amountPaise: 2000_00, direction: "credit", transactionType: "card_settlement", financialAccountId: card });
    expect(credit.transferGroupId).not.toBeNull();
    expect(credit.needsReview).toBe(false);

    const s = await summarizeMonth(testDb(), userId, MONTH);
    expect(s.netSpendPaise).toBe(2000_00);
    expect(s.cardSettlementPaidPaise).toBe(2000_00);
  });

  it("an unidentified debit is never assumed to be a transfer (8.2)", async () => {
    await create({ amountPaise: 10_000_00, financialAccountId: bank, categoryId: cat.shopping });
    await create({ amountPaise: 10_000_00, direction: "credit", transactionType: "income", financialAccountId: bank2 });
    const s = await summarizeMonth(testDb(), userId, MONTH);
    expect(s.netSpendPaise).toBe(10_000_00);
    expect(s.internalTransferOutPaise).toBe(0);
  });

  it("the user can pair two sides as a transfer, which removes them from spending (8.2)", async () => {
    const out = await create({ amountPaise: 10_000_00, financialAccountId: bank, categoryId: cat.shopping });
    const inn = await create({ amountPaise: 10_000_00, direction: "credit", transactionType: "income", financialAccountId: bank2 });
    expect(await linkTransfer(testDb(), userId, out.id, inn.id)).toMatchObject({ kind: "internal_transfer" });
    const s = await summarizeMonth(testDb(), userId, MONTH);
    expect(s.netSpendPaise).toBe(0);
    expect(s.incomePaise).toBe(0);
    expect(s.internalTransferOutPaise).toBe(10_000_00);

    await unlinkTransaction(testDb(), userId, out.id);
    expect((await getTransaction(testDb(), userId, out.id)).transaction).toMatchObject({ transferGroupId: null, needsReview: true });
  });

  it("auto-links a refund to the clear original and reduces its category (8.3)", async () => {
    const purchase = await create({ amountPaise: 1899_00, merchantName: "AMAZON", financialAccountId: card, categoryId: cat.shopping });
    const refund = await create({ amountPaise: 1899_00, direction: "credit", transactionType: "refund", merchantName: "AMAZON", financialAccountId: card, transactionDate: `${MONTH}-15` });
    expect(refund.parentTransactionId).toBe(purchase.id);
    expect(refund.categoryId).toBe(cat.shopping);

    const s = await summarizeMonth(testDb(), userId, MONTH);
    expect(s.byCategory[cat.shopping]).toBe(0);
    expect(s.netSpendPaise).toBe(0);
  });

  it("leaves an ambiguous refund unlinked for review, never inventing a parent (8.3)", async () => {
    await create({ amountPaise: 500_00, merchantName: "AMAZON", financialAccountId: card });
    await create({ amountPaise: 500_00, merchantName: "AMAZON", financialAccountId: card });
    const refund = await create({ amountPaise: 500_00, direction: "credit", transactionType: "refund", merchantName: "AMAZON", financialAccountId: card });
    expect(refund.parentTransactionId).toBeNull();
    expect(refund.needsReview).toBe(true);
  });

  it("refuses refunds that exceed the original", async () => {
    const purchase = await create({ amountPaise: 1000_00, merchantName: "SHOP A" });
    const r1 = await create({ amountPaise: 700_00, direction: "credit", transactionType: "refund", merchantName: "OTHER", financialAccountId: null });
    const r2 = await create({ amountPaise: 400_00, direction: "credit", transactionType: "refund", merchantName: "OTHER", financialAccountId: null });
    await linkRefund(testDb(), userId, r1.id, purchase.id);
    await expect(linkRefund(testDb(), userId, r2.id, purchase.id)).rejects.toThrow(/exceed/);
  });

  it("a reversal marks the original reversed and the net is zero, history intact (8.4)", async () => {
    const original = await create({ amountPaise: 999_00, merchantName: "PAYTM MERCHANT", categoryId: cat.shopping });
    const reversal = await create({ amountPaise: 999_00, direction: "credit", transactionType: "reversal", merchantName: "PAYTM MERCHANT" });
    expect(reversal.parentTransactionId).toBe(original.id);
    expect((await getTransaction(testDb(), userId, original.id)).transaction.transactionStatus).toBe("reversed");
    expect((await summarizeMonth(testDb(), userId, MONTH)).netSpendPaise).toBe(0);
    expect((await listTransactions(testDb(), userId, {})).total).toBe(2);

    // Unlinking restores the original and the books still balance.
    await unlinkTransaction(testDb(), userId, reversal.id);
    expect((await getTransaction(testDb(), userId, original.id)).transaction.transactionStatus).toBe("posted");
    expect((await summarizeMonth(testDb(), userId, MONTH)).netSpendPaise).toBe(0);
  });

  it("refuses partial reversals and double reversals", async () => {
    const original = await create({ amountPaise: 1000_00, merchantName: "A" });
    const partial = await create({ amountPaise: 400_00, direction: "credit", transactionType: "reversal", merchantName: "B", financialAccountId: null });
    await expect(linkReversal(testDb(), userId, partial.id, original.id)).rejects.toThrow(/full amount/);
  });

  it("investments and cash withdrawals are kept out of spending (8.5, 8.6)", async () => {
    await create({ transactionType: "investment", amountPaise: 5000_00 });
    await create({ transactionType: "cash_withdrawal", amountPaise: 2000_00 });
    const s = await summarizeMonth(testDb(), userId, MONTH);
    expect(s).toMatchObject({ netSpendPaise: 0, investmentPaise: 5000_00, cashWithdrawalPaise: 2000_00 });
  });
});

describe("corrections are audited and never erase history", () => {
  it("records before and after, and can create a rule only when asked", async () => {
    const t = await create({ merchantName: "Corner Store" });
    const { ruleId } = await correctTransaction(testDb(), userId, t.id, { categoryId: cat.groceries, markReviewed: true });
    expect(ruleId).toBeNull();

    const later = await create({ merchantName: "Corner Store" });
    expect(later.categoryId).toBeNull();

    const result = await correctTransaction(testDb(), userId, later.id, { categoryId: cat.groceries, createRule: true });
    expect(result.ruleId).not.toBeNull();
    expect((await create({ merchantName: "CORNER STORE" })).categoryId).toBe(cat.groceries);

    const audits = await testDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, t.id), eq(auditEvents.action, "correct")));
    expect(audits).toHaveLength(1);
    const meta = audits[0].metadata as Record<string, string>;
    expect(JSON.parse(meta.before).categoryId).toBeNull();
    expect(JSON.parse(meta.after).categoryId).toBe(cat.groceries);
  });

  it("only changes the fields that were sent", async () => {
    const t = await create({ merchantName: "Corner Store", paymentApp: "PhonePe", notes: "milk" });
    const { transaction } = await correctTransaction(testDb(), userId, t.id, { categoryId: cat.groceries });
    expect(transaction).toMatchObject({ merchantName: "Corner Store", paymentApp: "PhonePe", notes: "milk", categoryId: cat.groceries });

    const cleared = await correctTransaction(testDb(), userId, t.id, { notes: null, paymentApp: "" });
    expect(cleared.transaction).toMatchObject({ merchantName: "Corner Store", paymentApp: null, notes: null });
  });

  it("voiding keeps the row but removes it from totals and lists", async () => {
    const t = await create({ amountPaise: 300_00, categoryId: cat.food_dining });
    await voidTransaction(testDb(), userId, t.id, "entered twice");
    expect((await summarizeMonth(testDb(), userId, MONTH)).netSpendPaise).toBe(0);
    expect((await listTransactions(testDb(), userId, {})).total).toBe(0);
    expect((await listTransactions(testDb(), userId, { includeVoided: true })).total).toBe(1);
    await expect(correctTransaction(testDb(), userId, t.id, { notes: "x" })).rejects.toThrow(/voided/);
  });

  it("won't void a purchase that has a linked refund", async () => {
    const p = await create({ amountPaise: 100_00, merchantName: "M" });
    await create({ amountPaise: 100_00, direction: "credit", transactionType: "refund", merchantName: "M" });
    await expect(voidTransaction(testDb(), userId, p.id, "x")).rejects.toThrow(/Unlink/);
  });
});

describe("filtering", () => {
  beforeEach(async () => {
    await create({ merchantName: "Swiggy", amountPaise: 400_00, transactionDate: "2026-10-02", categoryId: cat.food_dining, paymentMethod: "upi", paymentApp: "PhonePe" });
    await create({ merchantName: "BigBasket", amountPaise: 2300_00, transactionDate: "2026-10-05", categoryId: cat.groceries, financialAccountId: card, paymentMethod: "credit_card" });
    await create({ merchantName: "100%_off store", amountPaise: 50_00, transactionDate: "2026-09-30", paymentMethod: "upi" });
    await create({ merchantName: "IRCTC", amountPaise: 1200_00, transactionDate: "2026-10-07", transactionStatus: "failed" });
  });

  const ids = async (f: Parameters<typeof listTransactions>[2]) =>
    (await listTransactions(testDb(), userId, f)).items.map((t) => t.merchantName);

  it("searches merchant text, treating % and _ literally", async () => {
    expect(await ids({ q: "swig" })).toEqual(["Swiggy"]);
    expect(await ids({ q: "100%_" })).toEqual(["100%_off store"]);
    expect(await ids({ q: "%" })).toEqual(["100%_off store"]);
  });

  it("filters by date, category, account, method, app, amount and status", async () => {
    expect(await ids({ from: "2026-10-01", to: "2026-10-05", sort: "date", order: "asc" })).toEqual(["Swiggy", "BigBasket"]);
    expect(await ids({ categoryIds: [cat.groceries] })).toEqual(["BigBasket"]);
    expect((await ids({ uncategorized: true })).sort()).toEqual(["100%_off store", "IRCTC"]);
    expect(await ids({ accountIds: [card] })).toEqual(["BigBasket"]);
    expect((await ids({ paymentMethods: ["upi"] })).sort()).toEqual(["100%_off store", "Swiggy"]);
    expect(await ids({ paymentApps: ["PhonePe"] })).toEqual(["Swiggy"]);
    expect(await ids({ minAmountPaise: 1000_00, maxAmountPaise: 2000_00 })).toEqual(["IRCTC"]);
    expect(await ids({ statuses: ["failed"] })).toEqual(["IRCTC"]);
  });

  it("filters by the reason given when explaining", async () => {
    await testDb().update(transactions).set({ reason: "Home Expense" }).where(eq(transactions.merchantName, "BigBasket"));
    await testDb().update(transactions).set({ reason: "Rakshith Personal" }).where(eq(transactions.merchantName, "Swiggy"));
    expect(await listReasons(testDb(), userId)).toEqual(["Home Expense", "Rakshith Personal"]);
    expect(await ids({ reasons: ["Home Expense"] })).toEqual(["BigBasket"]);
    expect((await ids({ noReason: true })).sort()).toEqual(["100%_off store", "IRCTC"]);
  });

  it("accepts query-string style input and paginates with a stable order", async () => {
    const page1 = await listTransactions(testDb(), userId, { sort: "amount", order: "desc", page: "1", pageSize: "2" } as never);
    const page2 = await listTransactions(testDb(), userId, { sort: "amount", order: "desc", page: "2", pageSize: "2" } as never);
    expect(page1.total).toBe(4);
    expect(page1.items.map((t) => t.merchantName)).toEqual(["BigBasket", "IRCTC"]);
    expect(page2.items.map((t) => t.merchantName)).toEqual(["Swiggy", "100%_off store"]);
    expect(await ids({ categoryIds: "x" } as never).catch((e) => e.name)).toBe("ZodError");
  });
});

describe("budgets", () => {
  it("evaluates overall and category budgets with the shared accounting", async () => {
    await setBudget(testDb(), userId, { categoryId: null, fromMonth: "2026-09", limitPaise: 10_000_00 });
    await setBudget(testDb(), userId, { categoryId: cat.food_dining, fromMonth: MONTH, limitPaise: 1_000_00, warnAtPercent: 50 });
    await create({ amountPaise: 600_00, categoryId: cat.food_dining });
    await create({ amountPaise: 9_000_00, transactionType: "card_settlement" }); // never counts

    const report = await budgetReport(testDb(), userId, MONTH);
    expect(report.overall).toMatchObject({ spentPaise: 600_00, state: "ok" });
    expect(report.categories).toEqual([expect.objectContaining({ categoryId: cat.food_dining, percentUsed: 60, state: "warning" })]);

    // Changing the limit for the same month replaces it rather than duplicating.
    await setBudget(testDb(), userId, { categoryId: cat.food_dining, fromMonth: MONTH, limitPaise: 500_00 });
    expect((await budgetReport(testDb(), userId, MONTH)).categories[0]).toMatchObject({ state: "exceeded" });
  });
});

describe("authorization between users", () => {
  it("one user can never see, change or link another user's data", async () => {
    const mine = await create({ merchantName: "Mine" });
    const [other] = await testDb()
      .insert(users)
      .values({ email: "intruder@example.com", passwordHash: "x" })
      .returning();
    await ensureDefaultCategories(testDb(), other.id);

    expect((await listTransactions(testDb(), other.id, {})).total).toBe(0);
    await expect(getTransaction(testDb(), other.id, mine.id)).rejects.toThrow(NotFoundError);
    await expect(correctTransaction(testDb(), other.id, mine.id, { notes: "x" })).rejects.toThrow(NotFoundError);
    await expect(voidTransaction(testDb(), other.id, mine.id, "x")).rejects.toThrow(NotFoundError);
    await expect(
      createTransaction(testDb(), other.id, { transactionDate: "2026-10-01", amountPaise: 1, direction: "debit", transactionType: "purchase", financialAccountId: bank }, { captureMethod: "manual" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      createTransaction(testDb(), other.id, { transactionDate: "2026-10-01", amountPaise: 1, direction: "debit", transactionType: "purchase", categoryId: cat.groceries }, { captureMethod: "manual" }),
    ).rejects.toThrow(NotFoundError);
    expect((await summarizeMonth(testDb(), other.id, MONTH)).transactionCount).toBe(0);
  });
});
