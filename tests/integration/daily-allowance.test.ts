import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/server/finance/accounts-service";
import { setBudget } from "@/server/finance/budgets-service";
import { listCategories } from "@/server/finance/categories-service";
import { dailyAllowances } from "@/server/finance/daily-allowance-service";
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
  it("is empty without a budget", async () => {
    expect(await dailyAllowances(testDb(), userId, "2026-11-18")).toEqual([]);
  });

  it("counts net spending per day from November, ignoring October and non-spending", async () => {
    await setBudget(testDb(), userId, { categoryId: null, fromMonth: "2026-10", limitPaise: 30_000_00 });
    await add({ transactionDate: "2026-10-31", amountPaise: 50_000_00 }); // before the start: ignored
    await add({ transactionDate: "2026-11-01", amountPaise: 800_00 });
    await add({ transactionDate: "2026-11-01", amountPaise: 5_000_00, transactionType: "internal_transfer" }); // not spending
    await add({ transactionDate: "2026-11-02", amountPaise: 300_00 });

    const [overall] = await dailyAllowances(testDb(), userId, "2026-11-02");
    expect(overall.categoryId).toBeNull();
    expect(overall.startMonth).toBe("2026-11");
    expect(overall.today).toMatchObject({ carryInPaise: 0, carriedToTodayPaise: 200_00, availableTodayPaise: 1_200_00, spentTodayPaise: 300_00, leftTodayPaise: 900_00 });
  });

  it("gives each category budget and each why its own allowance", async () => {
    await setBudget(testDb(), userId, { categoryId: null, fromMonth: "2026-11", limitPaise: 30_000_00 });
    await setBudget(testDb(), userId, { categoryId: cat.food_dining, fromMonth: "2026-11", limitPaise: 3_000_00 });
    await setBudget(testDb(), userId, { categoryId: null, reason: "Home Expense", fromMonth: "2026-11", limitPaise: 6_000_00 });
    await add({ amountPaise: 150_00, categoryId: cat.food_dining });
    const home = await add({ amountPaise: 400_00, categoryId: cat.groceries });
    await testDb().update(transactions).set({ reason: "Home Expense" }).where(eq(transactions.id, home.id));

    const all = await dailyAllowances(testDb(), userId, "2026-11-01");
    expect(all.map((a) => [a.categoryId, a.today.spentTodayPaise])).toEqual([
      [null, 550_00],
      [cat.food_dining, 150_00],
    ]);
    const [homeOnly] = await dailyAllowances(testDb(), userId, "2026-11-01", "Home Expense");
    expect(homeOnly.today).toMatchObject({ creditTodayPaise: 200_00, spentTodayPaise: 400_00, leftTodayPaise: -200_00 });
  });
});
