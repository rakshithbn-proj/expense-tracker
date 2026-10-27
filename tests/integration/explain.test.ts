import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categoryRules, explainSettings, transactions } from "@/server/db/schema";
import {
  explainTransaction,
  formatSlotTimes,
  getExplainSettings,
  lastSlotAtOrBefore,
  listToExplain,
  parseSlotTimes,
  takeDuePrompt,
  updateExplainSettings,
} from "@/server/explain/service";
import { createAccount } from "@/server/finance/accounts-service";
import { listCategories } from "@/server/finance/categories-service";
import { createTransaction, type CreateTransactionInput } from "@/server/finance/transactions-service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

let userId: string;
let card: string;
let cat: Record<string, string>;
// Times are India time (UTC+05:30). Default slots: 09:00, 12:00, 15:00, 18:00, 21:00.
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

// Captured at `at` (created_at), like a payment arriving through Gmail at that moment.
async function capture(at: Date, input: Partial<CreateTransactionInput> = {}) {
  const { transaction } = await createTransaction(
    testDb(),
    userId,
    { transactionDate: "2026-10-27", amountPaise: 1200_00, direction: "debit", transactionType: "purchase", financialAccountId: card, merchantName: "AMAZON", ...input },
    { captureMethod: "auto_email" },
  );
  await testDb().update(transactions).set({ createdAt: at }).where(eq(transactions.id, transaction.id));
  return transaction;
}

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  card = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Card", accountType: "credit_card", maskedIdentifier: "4321" })).id;
  cat = Object.fromEntries((await listCategories(testDb(), userId)).map((c) => [c.systemKey, c.id]));
  // Asking starts the morning of the 27th.
  await getExplainSettings(testDb(), userId, ist("2026-10-27", "08:00"));
});
afterAll(closeTestDb);

describe("schedule", () => {
  it("parses and normalises slot times", () => {
    expect(parseSlotTimes("18:00, 9:00 12:00,9:00")).toEqual([540, 720, 1080]);
    expect(formatSlotTimes([540, 1080])).toBe("09:00, 18:00");
    expect(() => parseSlotTimes("25:00")).toThrow(/isn't a time/);
    expect(() => parseSlotTimes("")).toThrow(/between 1 and 24/);
  });

  it("finds the latest slot, looking back to yesterday before the first one", () => {
    const slots = parseSlotTimes("09:00,15:00,21:00");
    expect(lastSlotAtOrBefore(ist("2026-10-27", "16:30"), slots)).toEqual(ist("2026-10-27", "15:00"));
    expect(lastSlotAtOrBefore(ist("2026-10-27", "15:00"), slots)).toEqual(ist("2026-10-27", "15:00"));
    expect(lastSlotAtOrBefore(ist("2026-10-27", "07:00"), slots)).toEqual(ist("2026-10-26", "21:00"));
  });

  it("validates settings", async () => {
    await expect(updateExplainSettings(testDb(), userId, { enabled: true, slotTimes: "9am", retryMinutes: 15 })).rejects.toThrow(/isn't a time/);
    await expect(updateExplainSettings(testDb(), userId, { enabled: true, slotTimes: "09:00", retryMinutes: 2 })).rejects.toThrow(/5 to 180/);
  });
});

describe("what gets asked", () => {
  it("asks only about real spending captured since asking started", async () => {
    await capture(ist("2026-10-27", "07:00")); // before asking started
    const amazon = await capture(ist("2026-10-27", "10:00"));
    await capture(ist("2026-10-27", "10:05"), { transactionType: "card_settlement", merchantName: "HDFC card bill" });
    await capture(ist("2026-10-27", "10:06"), { transactionType: "internal_transfer", merchantName: "To savings" });
    await capture(ist("2026-10-27", "10:07"), { transactionStatus: "failed", merchantName: "Declined" });
    await capture(ist("2026-10-27", "10:08"), { direction: "credit", transactionType: "refund", merchantName: "Refund" });
    const items = await listToExplain(testDb(), userId, ist("2026-10-27", "12:30"));
    expect(items.map((i) => i.id)).toEqual([amazon.id]);
    expect(items[0].label).toBe("₹1,200.00 · AMAZON · HDFC Bank Card ••4321 · Today 10:00 am");
  });

  it("says how the payment was made when the account name doesn't", async () => {
    await capture(ist("2026-10-27", "10:00"), { paymentMethod: "credit_card" });
    await capture(ist("2026-10-27", "10:10"), { paymentMethod: "upi", merchantName: "SWIGGY", financialAccountId: null });
    const items = await listToExplain(testDb(), userId, ist("2026-10-27", "12:30"));
    expect(items.map((i) => i.label)).toEqual([
      "₹1,200.00 · AMAZON · HDFC Bank Card ••4321 · Today 10:00 am",
      "₹1,200.00 · SWIGGY · UPI · Today 10:10 am",
    ]);
  });

  it("waits for the next slot, then asks once until the retry interval passes", async () => {
    await capture(ist("2026-10-27", "12:10"));
    expect(await takeDuePrompt(testDb(), userId, ist("2026-10-27", "14:00"))).toBeNull(); // no slot since capture yet

    // Phone locked at 15:00: nothing asks. First app opened at 15:40 gets the batch.
    const prompt = await takeDuePrompt(testDb(), userId, ist("2026-10-27", "15:40"));
    expect(prompt?.title).toBe("1 payment to explain");
    expect(prompt?.items[0].categories.at(-1)).toBe("Other / Uncategorized");

    // Skipped: opening another app straight away doesn't ask again...
    expect(await takeDuePrompt(testDb(), userId, ist("2026-10-27", "15:45"))).toBeNull();
    // ...but it does after 15 minutes.
    expect(await takeDuePrompt(testDb(), userId, ist("2026-10-27", "15:56"))).not.toBeNull();
  });

  it("includes payments captured after the slot in the same batch", async () => {
    await capture(ist("2026-10-27", "13:00"));
    await capture(ist("2026-10-27", "15:20"), { merchantName: "SWIGGY" });
    const prompt = await takeDuePrompt(testDb(), userId, ist("2026-10-27", "15:40"));
    expect(prompt?.items.map((i) => i.merchant)).toEqual(["AMAZON", "SWIGGY"]);
  });

  it("puts the current category first", async () => {
    await capture(ist("2026-10-27", "10:00"), { categoryId: cat.shopping });
    const prompt = await takeDuePrompt(testDb(), userId, ist("2026-10-27", "12:00"));
    expect(prompt?.items[0].categories[0]).toBe("Shopping");
  });

  it("asks right away when run by hand, and never when turned off", async () => {
    await capture(ist("2026-10-27", "12:10"));
    expect(await takeDuePrompt(testDb(), userId, ist("2026-10-27", "12:20"), { manual: true })).not.toBeNull();
    await updateExplainSettings(testDb(), userId, { enabled: false, slotTimes: "09:00,12:00,15:00", retryMinutes: 15 });
    expect(await takeDuePrompt(testDb(), userId, ist("2026-10-27", "15:30"))).toBeNull();
  });

  it("gives a batch to only one of several automations firing at once", async () => {
    await capture(ist("2026-10-27", "10:00"));
    const now = ist("2026-10-27", "12:30");
    const results = await Promise.all([1, 2, 3].map(() => takeDuePrompt(testDb(), userId, now)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const [s] = await testDb().select().from(explainSettings);
    expect(s.promptLeaseUntil).toEqual(new Date(now.getTime() + 15 * 60_000));
  });
});

describe("answering", () => {
  it("saves the category and reason, and stops asking", async () => {
    const t = await capture(ist("2026-10-27", "10:00"));
    const saved = await explainTransaction(testDb(), userId, t.id, { categoryName: "food & dining", reason: "Dinner with Ravi" });
    expect(saved).toMatchObject({ categoryId: cat.food_dining, reason: "Dinner with Ravi", needsReview: false });
    expect(saved.explainedAt).not.toBeNull();
    expect(await listToExplain(testDb(), userId)).toEqual([]);
  });

  it("can remember the category for the payee", async () => {
    const t = await capture(ist("2026-10-27", "10:00"));
    await explainTransaction(testDb(), userId, t.id, { categoryId: cat.shopping, remember: true });
    const rules = await testDb().select().from(categoryRules);
    expect(rules).toMatchObject([{ matchValue: "AMAZON", categoryId: cat.shopping }]);
  });

  it("rejects an unknown category", async () => {
    const t = await capture(ist("2026-10-27", "10:00"));
    await expect(explainTransaction(testDb(), userId, t.id, { categoryName: "Nope" })).rejects.toThrow(/no category called/);
  });
});
