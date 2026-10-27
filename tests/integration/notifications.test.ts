import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { gmailConnections, notifications, sheetsConnections, sourceHealth, transactionSources, users } from "@/server/db/schema";
import { createAccount } from "@/server/finance/accounts-service";
import { setBudget } from "@/server/finance/budgets-service";
import { listCategories } from "@/server/finance/categories-service";
import { correctTransaction, createTransaction, type CreateTransactionInput } from "@/server/finance/transactions-service";
import { explainTransaction } from "@/server/explain/service";
import { enqueueSource, resetForRetry } from "@/server/ingestion/queue";
import { refreshNotifications } from "@/server/notifications/rules";
import { applyNotifications, dismiss, listNotifications, markRead, unreadCount } from "@/server/notifications/service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

let userId: string;
let bank: string;
let food: string;
// 18:00 India time on 22 October 2026: after the daily-summary hour.
let clock: Date;

const refresh = () => refreshNotifications(testDb(), userId, clock);
const all = () => testDb().select().from(notifications).where(eq(notifications.userId, userId));
const byKey = async (key: string) => (await all()).find((n) => n.dedupKey === key);
// Open alerts other than the daily summary (every refresh after 7 am creates one) and the
// "payments to explain" reminder (every new payment creates one); both are tested on their own.
const open = async () =>
  (await listNotifications(testDb(), userId)).active
    .map((n) => n.dedupKey)
    .filter((k) => !k.startsWith("daily:") && k !== "to_explain")
    .sort();

const add = async (input: Partial<CreateTransactionInput>) =>
  (
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-10-22", amountPaise: 100_00, direction: "debit", transactionType: "purchase", financialAccountId: bank, categoryId: food, ...input },
      { captureMethod: "manual" },
    )
  ).transaction;

async function problemSource(id: string, status: "unrecognized" | "failed", at = clock) {
  await enqueueSource(testDb(), { userId, sourceType: "gmail", sourceIdentifier: "me@gmail.example", sourceMessageId: id }, at);
  await testDb().update(transactionSources).set({ parseStatus: status }).where(eq(transactionSources.sourceMessageId, id));
}

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  await testDb().update(users).set({ createdAt: new Date("2026-09-01T00:00:00Z") }).where(eq(users.id, userId));
  bank = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Savings", accountType: "bank_account" })).id;
  food = (await listCategories(testDb(), userId)).find((c) => c.systemKey === "food_dining")!.id;
  clock = new Date("2026-10-22T12:30:00Z");
});
afterAll(closeTestDb);

describe("conditions", () => {
  it("raises, resolves and reopens the Gmail reconnect alert", async () => {
    await testDb().insert(gmailConnections).values({ userId, emailAddress: "me@gmail.example", scope: "x", status: "needs_reauth" });
    await refresh();
    const raised = await byKey("gmail_auth");
    expect(raised).toMatchObject({ severity: "critical", resolvedAt: null, readAt: null, href: "/automation" });
    await markRead(testDb(), userId, raised!.id, clock);

    await testDb().update(gmailConnections).set({ status: "connected" });
    await refresh();
    expect((await byKey("gmail_auth"))!.resolvedAt).toEqual(clock);
    expect(await open()).toEqual([]);

    await testDb().update(gmailConnections).set({ status: "needs_reauth" });
    clock = new Date(clock.getTime() + 60_000);
    await refresh();
    const reopened = await byKey("gmail_auth");
    expect(reopened).toMatchObject({ id: raised!.id, resolvedAt: null, readAt: null });
    expect((await all()).filter((n) => n.kind === "gmail_auth")).toHaveLength(1);
  });

  it("only warns about Gmail check failures after several in a row", async () => {
    await testDb().insert(gmailConnections).values({ userId, emailAddress: "me@gmail.example", scope: "x", status: "connected", lastError: "Gmail API 503" });
    await testDb().insert(sourceHealth).values({ userId, sourceType: "gmail", sourceName: "Gmail", status: "temporarily_failing", consecutiveFailures: 2 });
    await refresh();
    expect(await byKey("gmail_failing")).toBeUndefined();
    await testDb().update(sourceHealth).set({ consecutiveFailures: 3 });
    await refresh();
    expect((await byKey("gmail_failing"))!.body).toContain("Gmail API 503");
  });

  it("raises Sheets alerts for lost access and repeated failures", async () => {
    await testDb().insert(sheetsConnections).values({ userId, scope: "x", status: "connected", consecutiveFailures: 3, lastError: "Google Sheets 503" });
    await refresh();
    expect(await open()).toEqual(["sheets_failing"]);
    await testDb().update(sheetsConnections).set({ status: "needs_reauth" });
    await refresh();
    expect(await open()).toEqual(["sheets_auth"]);
  });

  it("groups unreadable alerts by day and clears them once retried", async () => {
    await problemSource("m1", "unrecognized");
    await refresh();
    const first = (await byKey("capture_issues:2026-10-22"))!;
    expect(first.title).toBe("1 alert from 22 Oct 2026 couldn't be recorded");
    await markRead(testDb(), userId, "all", clock);

    // A second problem the same day updates the same alert and makes it unread again.
    await problemSource("m2", "failed");
    await refresh();
    const second = (await byKey("capture_issues:2026-10-22"))!;
    expect(second.id).toBe(first.id);
    expect(second.title).toContain("2 alerts");
    expect(second.body).toContain("1 not recognised, 1 failed after retries");
    expect(second.readAt).toBeNull();

    await resetForRetry(testDb(), userId, "all-failed", clock);
    await refresh();
    expect((await byKey("capture_issues:2026-10-22"))!.resolvedAt).not.toBeNull();
  });

  it("counts uncategorised transactions separately from other review reasons", async () => {
    const tx = await add({ categoryId: null });
    await refresh();
    expect(await open()).toEqual(["uncategorized"]);

    await add({ financialAccountId: null }); // categorised, but the account is unknown
    await refresh();
    expect(await open()).toEqual(["needs_review", "uncategorized"]);
    expect((await byKey("needs_review"))!.title).toBe("1 transaction needs review");

    await correctTransaction(testDb(), userId, tx.id, { categoryId: food });
    await refresh();
    expect(await open()).toEqual(["needs_review"]);
  });

  it("doesn't mark a count change as unread for informational alerts", async () => {
    await add({ categoryId: null });
    await refresh();
    await markRead(testDb(), userId, "all", clock);
    await add({ categoryId: null });
    await refresh();
    const n = (await byKey("uncategorized"))!;
    expect(n.title).toBe("2 transactions without a category");
    expect(n.readAt).not.toBeNull();
  });

  it("reminds about payments to explain until they're answered", async () => {
    const tx = await add({});
    await refresh();
    expect((await byKey("to_explain"))!).toMatchObject({ title: "1 payment to explain", href: "/explain", resolvedAt: null });
    await explainTransaction(testDb(), userId, tx.id, { categoryId: food, reason: "Lunch" });
    await refresh();
    expect((await byKey("to_explain"))!.resolvedAt).not.toBeNull();
  });

  it("can't be dismissed, only fixed", async () => {
    await add({ categoryId: null });
    await refresh();
    await expect(dismiss(testDb(), userId, (await byKey("uncategorized"))!.id)).rejects.toThrow(/clears by itself/);
  });
});

describe("budget warnings", () => {
  it("warns at the threshold, then again when exceeded, and stays dismissed", async () => {
    await setBudget(testDb(), userId, { categoryId: null, fromMonth: "2026-10", limitPaise: 1000_00 });
    await add({ amountPaise: 850_00 });
    await refresh();
    const warning = (await byKey("budget:2026-10:overall:warning"))!;
    expect(warning.title).toBe("Overall budget at 85%");
    expect(warning.body).toContain("left");

    await add({ amountPaise: 300_00 });
    await refresh();
    const exceeded = (await byKey("budget:2026-10:overall:exceeded"))!;
    expect(exceeded.title).toBe("Overall budget exceeded");
    expect(exceeded.body).toContain("over");

    await dismiss(testDb(), userId, exceeded.id, clock);
    await refresh();
    expect((await byKey("budget:2026-10:overall:exceeded"))!.resolvedAt).not.toBeNull();
    // Events don't resolve by themselves.
    expect((await byKey("budget:2026-10:overall:warning"))!.resolvedAt).toBeNull();
  });

  it("names the category for category budgets", async () => {
    await setBudget(testDb(), userId, { categoryId: food, fromMonth: "2026-10", limitPaise: 100_00 });
    await add({ amountPaise: 150_00 });
    await refresh();
    expect((await byKey(`budget:2026-10:${food}:exceeded`))!.title).toBe("Food & Dining budget exceeded");
  });
});

describe("daily summary", () => {
  it("summarises yesterday from 7 am India time", async () => {
    await add({ transactionDate: "2026-10-21", amountPaise: 400_00 });
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-10-21", amountPaise: 100_00, direction: "debit", transactionType: "purchase", financialAccountId: bank, categoryId: food },
      { captureMethod: "auto_email" },
    );

    clock = new Date("2026-10-22T01:00:00Z"); // 06:30 IST: the summary of the 20th is still current
    await refresh();
    expect(await byKey("daily:2026-10-21")).toBeUndefined();
    expect((await byKey("daily:2026-10-20"))!.resolvedAt).toBeNull();

    clock = new Date("2026-10-22T01:45:00Z"); // 07:15 IST
    await refresh();
    const summary = (await byKey("daily:2026-10-21"))!;
    expect(summary.title).toBe("Summary for 21 Oct 2026");
    expect(summary.body).toBe("Net spending ₹500.00 across 2 transactions: 1 captured automatically, 1 added by you or imported.");
    expect(summary.href).toBe("/transactions?from=2026-10-21&to=2026-10-21");
    // Only the latest summary stays open.
    expect((await byKey("daily:2026-10-20"))!.resolvedAt).toEqual(clock);
  });

  it("says so honestly when nothing was recorded", async () => {
    await refresh();
    expect((await byKey("daily:2026-10-21"))!.body).toContain("No transactions were recorded");
  });

  it("isn't created for days before the account existed", async () => {
    await testDb().update(users).set({ createdAt: new Date("2026-10-22T03:00:00Z") }).where(eq(users.id, userId));
    await refresh();
    expect(await byKey("daily:2026-10-21")).toBeUndefined();
  });
});

describe("storage", () => {
  it("is idempotent", async () => {
    await add({ categoryId: null });
    await refresh();
    const before = await all();
    clock = new Date(clock.getTime() + 60_000);
    await refresh();
    expect(await all()).toEqual(before);
  });

  it("deletes read or resolved alerts after 90 days, but keeps unread open ones", async () => {
    await applyNotifications(
      testDb(),
      userId,
      [
        { key: "budget:2026-06:overall:warning", kind: "budget", severity: "warning", title: "old", body: "b", href: null },
        { key: "daily:2026-06-01", kind: "daily_summary", severity: "info", title: "old unread", body: "b", href: null },
      ],
      new Date("2026-06-01T00:00:00Z"),
    );
    await testDb()
      .update(notifications)
      .set({ readAt: new Date("2026-06-01T00:00:00Z") })
      .where(and(eq(notifications.userId, userId), eq(notifications.dedupKey, "budget:2026-06:overall:warning")));
    await applyNotifications(testDb(), userId, [], clock);
    expect((await all()).map((n) => n.dedupKey)).toEqual(["daily:2026-06-01"]);
  });

  it("lists critical alerts first and counts unread ones", async () => {
    await add({ categoryId: null });
    await testDb().insert(gmailConnections).values({ userId, emailAddress: "me@gmail.example", scope: "x", status: "needs_reauth" });
    await refresh();
    const { active } = await listNotifications(testDb(), userId);
    expect(active[0].dedupKey).toBe("gmail_auth");
    expect(await unreadCount(testDb(), userId)).toBe(active.length);
  });
});
