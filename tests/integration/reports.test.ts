import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decimalToPaise } from "@/lib/money";
import { createAccount } from "@/server/finance/accounts-service";
import { listCategories } from "@/server/finance/categories-service";
import { lookups, overview, reports, summarizeMonths, loadAnalyzed } from "@/server/finance/reports-service";
import { createTransaction, summarizeMonth, voidTransaction, type CreateTransactionInput } from "@/server/finance/transactions-service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

let userId: string;
let cat: Record<string, string>;
let bank: string;
let bank2: string;
let card: string;

const add = async (input: Partial<CreateTransactionInput>) =>
  (
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-10-10", amountPaise: 100_00, direction: "debit", transactionType: "purchase", financialAccountId: bank, ...input },
      { captureMethod: "manual" },
    )
  ).transaction;

// An independent statement of the spending rules in plain SQL, used to check the TypeScript.
async function sqlNetSpending(month: string): Promise<number> {
  const { rows } = await testDb().execute<{ net: string | null }>(sql`
    select coalesce(sum(case
        when t.transaction_type in ('purchase','fee') and t.direction = 'debit' then t.amount
        when t.transaction_type = 'refund' then -t.amount
        when t.transaction_type = 'reversal' and t.parent_transaction_id is null then -t.amount
        else 0 end), 0)::text as net
    from transactions t
    where t.user_id = ${userId}
      and t.voided_at is null
      and t.currency = 'INR'
      and t.transaction_status not in ('failed','reversed')
      and to_char(t.transaction_date, 'YYYY-MM') = ${month}`);
  return decimalToPaise(rows[0].net ?? "0");
}

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  cat = Object.fromEntries((await listCategories(testDb(), userId)).map((c) => [c.systemKey, c.id]));
  bank = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Savings", accountType: "bank_account" })).id;
  bank2 = (await createAccount(testDb(), userId, { institutionName: "SBI", accountName: "Savings", accountType: "bank_account" })).id;
  card = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Card", accountType: "credit_card" })).id;

  // A month exercising every rule, plus a refund of a September purchase.
  const sept = await add({ transactionDate: "2026-09-20", amountPaise: 3000_00, merchantName: "CROMA", financialAccountId: card, categoryId: cat.shopping });
  await add({ transactionDate: "2026-10-01", amountPaise: 85_000_00, direction: "credit", transactionType: "income" });
  await add({ transactionDate: "2026-10-03", amountPaise: 25_000_00, categoryId: cat.rent_housing, paymentMethod: "net_banking" });
  await add({ transactionDate: "2026-10-04", amountPaise: 412_00, merchantName: "SWIGGY", categoryId: cat.food_dining, paymentMethod: "upi" });
  await add({ transactionDate: "2026-10-05", amountPaise: 2340_00, merchantName: "BIGBASKET", financialAccountId: card, categoryId: cat.groceries, paymentMethod: "credit_card" });
  await add({ transactionDate: "2026-10-06", amountPaise: 1899_00, merchantName: "AMAZON", financialAccountId: card, categoryId: cat.shopping, paymentMethod: "credit_card" });
  await add({ transactionDate: "2026-10-08", amountPaise: 1899_00, direction: "credit", transactionType: "refund", merchantName: "AMAZON", financialAccountId: card });
  await add({ transactionDate: "2026-10-09", amountPaise: 1000_00, direction: "credit", transactionType: "refund", merchantName: "CROMA", financialAccountId: card });
  await add({ transactionDate: "2026-10-11", amountPaise: 750_00, merchantName: "unknown payee" });
  await add({ transactionDate: "2026-10-12", amountPaise: 999_00, merchantName: "PAYTM", financialAccountId: bank2 });
  await add({ transactionDate: "2026-10-13", amountPaise: 999_00, direction: "credit", transactionType: "reversal", merchantName: "PAYTM", financialAccountId: bank2 });
  await add({ transactionDate: "2026-10-14", amountPaise: 300_00, direction: "credit", transactionType: "reversal", merchantName: "NOBODY", financialAccountId: null });
  await add({ transactionDate: "2026-10-15", amountPaise: 1200_00, transactionStatus: "failed", merchantName: "IRCTC" });
  await add({ transactionDate: "2026-10-16", amountPaise: 450_00, transactionStatus: "pending", merchantName: "ZEPTO", financialAccountId: card, categoryId: cat.groceries });
  await add({ transactionDate: "2026-10-17", amountPaise: 5000_00, transactionType: "investment" });
  await add({ transactionDate: "2026-10-18", amountPaise: 2000_00, transactionType: "cash_withdrawal" });
  await add({ transactionDate: "2026-10-19", amountPaise: 499_00, transactionType: "fee", categoryId: cat.bills_utilities });
  await add({ transactionDate: "2026-10-20", amountPaise: 15_000_00, transactionType: "card_settlement" });
  await add({ transactionDate: "2026-10-20", amountPaise: 15_000_00, direction: "credit", transactionType: "card_settlement", financialAccountId: card });
  await add({ transactionDate: "2026-10-21", amountPaise: 10_000_00, transactionType: "internal_transfer" });
  await add({ transactionDate: "2026-10-21", amountPaise: 10_000_00, direction: "credit", transactionType: "internal_transfer", financialAccountId: bank2 });
  await add({ transactionDate: "2026-10-22", amountPaise: 99_00, currency: "USD", merchantName: "APP STORE" });
  const voided = await add({ transactionDate: "2026-10-22", amountPaise: 777_00, merchantName: "DUPLICATE" });
  await voidTransaction(testDb(), userId, voided.id, "duplicate");
  expect(sept.id).toBeTruthy();
});
afterAll(closeTestDb);

describe("dashboard and reports agree with the database", () => {
  it("overview net spending equals the summary and the independent SQL", async () => {
    const expected = 25_000_00 + 412_00 + 2340_00 + 1899_00 - 1899_00 - 1000_00 + 750_00 - 300_00 + 450_00 + 499_00;
    const sqlNet = await sqlNetSpending("2026-10");
    const summary = await summarizeMonth(testDb(), userId, "2026-10");
    const view = await overview(testDb(), userId, "2026-10", "2026-10-22");

    expect(sqlNet).toBe(expected);
    expect(summary.netSpendPaise).toBe(expected);
    expect(view.summary.netSpendPaise).toBe(expected);
    expect(view.summary.byCategory).toEqual(summary.byCategory);
    expect(view.summary.pendingSpendPaise).toBe(450_00);
    expect(view.summary.excludedForeignCurrencyCount).toBe(1);
  });

  it("every breakdown adds up to the same net spending", async () => {
    const view = await overview(testDb(), userId, "2026-10", "2026-10-22");
    const net = view.summary.netSpendPaise;
    const sum = (gs: { paise: number }[]) => gs.reduce((s, g) => s + g.paise, 0);
    expect(sum(view.byCategory)).toBe(net);
    expect(sum(view.byPaymentMethod)).toBe(net);
    expect(view.cumulative.current.at(-1)).toBe(net);
    expect(view.weekdays.reduce((s, w) => s + w.totalPaise, 0)).toBe(net);
  });

  it("a refund of last month's purchase reduces this month in the original category", async () => {
    const view = await overview(testDb(), userId, "2026-10", "2026-10-22");
    const shopping = view.byCategory.find((g) => g.key === cat.shopping);
    expect(shopping?.paise).toBe(1899_00 - 1899_00 - 1000_00);
  });

  it("monthly report rows match the per-month summaries", async () => {
    const r = await reports(testDb(), userId, { from: "2026-10-01", to: "2026-10-31" }, "2026-10-22");
    const oct = r.monthly.find((m) => m.month === "2026-10")!;
    const sep = r.monthly.find((m) => m.month === "2026-09")!;
    expect(oct.netSpendPaise).toBe(await sqlNetSpending("2026-10"));
    expect(sep.netSpendPaise).toBe(await sqlNetSpending("2026-09"));
    expect(oct).toMatchObject({ incomePaise: 85_000_00, investmentPaise: 5000_00, cashWithdrawalPaise: 2000_00, internalTransferOutPaise: 10_000_00, cardSettlementPaidPaise: 15_000_00 });
  });

  it("summarizeMonths over loaded rows matches summarizeMonth from the service", async () => {
    const loaded = await loadAnalyzed(testDb(), userId, { start: "2026-09-01", endExclusive: "2026-11-01" });
    const [sep, oct] = summarizeMonths(loaded, ["2026-09", "2026-10"]);
    // The service adds two counts on top of the shared summary; compare everything else.
    const core = <T extends object>(s: T) =>
      Object.fromEntries(Object.entries(s).filter(([k]) => !["month", "sampleTransactionCount", "needsReviewCount"].includes(k)));
    expect(core(oct)).toEqual(core(await summarizeMonth(testDb(), userId, "2026-10")));
    expect(core(sep)).toEqual(core(await summarizeMonth(testDb(), userId, "2026-09")));
  });

  it("names never leak between users", async () => {
    const names = await lookups(testDb(), userId);
    expect(names.accounts).toHaveLength(3);
    expect(names.categories.length).toBeGreaterThanOrEqual(14);
  });
});
