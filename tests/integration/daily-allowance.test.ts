import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/server/finance/accounts-service";
import { setBudget } from "@/server/finance/budgets-service";
import { listCategories } from "@/server/finance/categories-service";
import { dailyAllowance } from "@/server/finance/daily-allowance-service";
import { createTransaction, type CreateTransactionInput } from "@/server/finance/transactions-service";
import { transactions } from "@/server/db/schema";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

let userId: string;
let cat: Record<string, string>;
let bank: string;

const add = async (input: Partial<CreateTransactionInput>) =>
  (
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-11-01", amountPaise: 100_00, direction: "debit", transactionType: "purchase", financialAccountId: bank, ...input },
      { captureMethod: "manual" },
    )
  ).transaction;

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  cat = Object.fromEntries((await listCategories(testDb(), userId)).map((c) => [c.systemKey, c.id]));
  bank = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Savings", accountType: "bank_account" })).id;
});
afterAll(closeTestDb);

describe("dailyAllowances", () => {
  it("is null without a total budget, even when a category has one", async () => {
    expect(await dailyAllowance(testDb(), userId, "2026-11-18")).toBeNull();
    await setBudget(testDb(), userId, { categoryId: cat.food_dining, fromMonth: "2026-11", limitPaise: 3_000_00 });
    expect(await dailyAllowance(testDb(), userId, "2026-11-18")).toBeNull();
  });

  it("counts net spending per day from November, ignoring October and non-spending", async () => {
    await setBudget(testDb(), userId, { categoryId: null, fromMonth: "2026-10", limitPaise: 30_000_00 });
    await add({ transactionDate: "2026-10-31", amountPaise: 50_000_00 }); // before the start: ignored
    await add({ transactionDate: "2026-11-01", amountPaise: 800_00 });
    await add({ transactionDate: "2026-11-01", amountPaise: 5_000_00, transactionType: "internal_transfer" }); // not spending
    await add({ transactionDate: "2026-11-02", amountPaise: 300_00 });

    const overall = (await dailyAllowance(testDb(), userId, "2026-11-02"))!;
    expect(overall.startMonth).toBe("2026-11");
    expect(overall.today).toMatchObject({ carryInPaise: 0, carriedToTodayPaise: 200_00, availableTodayPaise: 1_200_00, spentTodayPaise: 300_00, leftTodayPaise: 900_00 });
  });

  it("works on a why's total across all its categories, ignoring category budgets", async () => {
    await setBudget(testDb(), userId, { categoryId: null, reason: "Shared Rental Expense", fromMonth: "2026-11", limitPaise: 6_000_00 });
    await setBudget(testDb(), userId, { categoryId: cat.food_dining, reason: "Shared Rental Expense", fromMonth: "2026-11", limitPaise: 1_000_00 });
    const food = await add({ amountPaise: 150_00, categoryId: cat.food_dining });
    const groceries = await add({ amountPaise: 400_00, categoryId: cat.groceries });
    await add({ amountPaise: 999_00, categoryId: cat.groceries }); // no why: not this why's spending
    for (const t of [food, groceries]) await testDb().update(transactions).set({ reason: "Shared Rental Expense" }).where(eq(transactions.id, t.id));

    const shared = (await dailyAllowance(testDb(), userId, "2026-11-01", "Shared Rental Expense"))!;
    // ₹6,000 over 30 days = ₹200 a day; ₹550 spent across food and groceries.
    expect(shared.today).toMatchObject({ creditTodayPaise: 200_00, spentTodayPaise: 550_00, leftTodayPaise: -350_00 });
  });
});
