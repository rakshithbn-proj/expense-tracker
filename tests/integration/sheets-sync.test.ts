import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sheetsConnections } from "@/server/db/schema";
import type { SheetsConfig } from "@/server/env";
import { TRANSACTION_HEADERS } from "@/server/export/table";
import { createAccount } from "@/server/finance/accounts-service";
import { listCategories, updateCategory } from "@/server/finance/categories-service";
import { createTransaction, voidTransaction, type CreateTransactionInput } from "@/server/finance/transactions-service";
import { SHEETS_SCOPE } from "@/server/sheets/client";
import { disconnectSheets, getSheetsConnection, saveSheetsConnection, syncSheets } from "@/server/sheets/service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";
import { FakeSheets } from "../support/fake-sheets";

const config: SheetsConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3000/api/sheets/callback",
  encryptionKey: randomBytes(32),
};

let userId: string;
let bank: string;
let food: string;
let google: FakeSheets;
let clock: Date;
const deps = () => ({ config, fetchImpl: google.fetch, now: () => clock });
const sync = (force = false) => syncSheets(testDb(), userId, deps(), { force });
const conn = async () => (await getSheetsConnection(testDb(), userId))!;
const col = (name: string) => TRANSACTION_HEADERS.indexOf(name);

const add = async (input: Partial<CreateTransactionInput>, isSample = false) =>
  (
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-10-10", amountPaise: 250_50, direction: "debit", transactionType: "purchase", financialAccountId: bank, categoryId: food, ...input },
      { captureMethod: isSample ? "sample" : "manual", isSample },
    )
  ).transaction;

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  bank = (await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Savings", accountType: "bank_account", maskedIdentifier: "1234" })).id;
  food = (await listCategories(testDb(), userId)).find((c) => c.systemKey === "food_dining")!.id;
  google = new FakeSheets();
  clock = new Date("2026-10-22T12:00:00Z");
  await saveSheetsConnection(testDb(), userId, { refreshToken: "sheets-refresh-secret", scope: SHEETS_SCOPE, emailAddress: "sheets-owner@gmail.example" }, config);
});
afterAll(closeTestDb);

describe("connecting", () => {
  it("stores the refresh token encrypted", async () => {
    const [row] = await testDb().select().from(sheetsConnections);
    expect(row.refreshTokenEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain("sheets-refresh-secret");
  });

  it("refuses a grant without spreadsheet access", async () => {
    await expect(saveSheetsConnection(testDb(), userId, { refreshToken: "t", scope: "openid email", emailAddress: null }, config)).rejects.toThrow(/not granted/);
  });

  it("records the Google account that owns the spreadsheet", async () => {
    expect((await conn()).emailAddress).toBe("sheets-owner@gmail.example");
  });

  it("reconnecting the same account keeps the spreadsheet; switching account starts a new one", async () => {
    await add({});
    await sync();
    const first = (await conn()).spreadsheetId!;

    await saveSheetsConnection(testDb(), userId, { refreshToken: "again", scope: SHEETS_SCOPE, emailAddress: "sheets-owner@gmail.example" }, config);
    expect((await conn()).spreadsheetId).toBe(first);

    await saveSheetsConnection(testDb(), userId, { refreshToken: "other", scope: SHEETS_SCOPE, emailAddress: "someone-else@gmail.example" }, config);
    const switched = await conn();
    expect(switched).toMatchObject({ emailAddress: "someone-else@gmail.example", spreadsheetId: null, spreadsheetUrl: null, lastSyncAt: null });
    expect(await sync()).toEqual({ status: "synced", rows: 1 });
    expect((await conn()).spreadsheetId).not.toBe(first);
  });

  it("disconnecting revokes the token but keeps the spreadsheet link", async () => {
    await add({});
    await sync();
    await disconnectSheets(testDb(), userId, deps());
    const c = await conn();
    expect(c.status).toBe("disconnected");
    expect(c.refreshTokenEncrypted).toBeNull();
    expect(c.spreadsheetUrl).toContain("docs.google.com");
    expect(await sync(true)).toEqual({ status: "skipped", reason: "not_connected" });
  });
});

describe("syncing", () => {
  it("creates the spreadsheet and writes one row per transaction, newest first", async () => {
    const older = await add({ transactionDate: "2026-10-01", merchantName: "Swiggy" });
    const newer = await add({ transactionDate: "2026-10-15", merchantName: "Amazon", direction: "credit", transactionType: "refund", amountPaise: 99_00 });
    expect(await sync()).toEqual({ status: "synced", rows: 2 });

    const c = await conn();
    const rows = google.tab(c.spreadsheetId!);
    expect(rows[0]).toEqual(TRANSACTION_HEADERS);
    expect(rows.slice(1).map((r) => r[col("Transaction ID")])).toEqual([newer.id, older.id]);
    expect(rows[2][col("Amount (INR)")]).toBe(250.5);
    expect(rows[2][col("Signed amount (INR)")]).toBe(-250.5);
    expect(rows[1][col("Signed amount (INR)")]).toBe(99);
    expect(rows[2][col("Account or card")]).toBe("HDFC Bank Savings ••1234");
    expect(c.syncedRowCount).toBe(2);
    expect(c.lastSyncAt).toEqual(clock);
  });

  it("writes text exactly as text, so a formula-like merchant name is never run", async () => {
    await add({ merchantName: '=HYPERLINK("http://evil.example","x")' });
    await sync();
    const rows = google.tab((await conn()).spreadsheetId!);
    // The fake rejects anything but valueInputOption=RAW, which stores the string verbatim.
    expect(rows[1][col("Merchant")]).toBe('=HYPERLINK("http://evil.example","x")');
  });

  it("leaves out sample data and voided transactions", async () => {
    await add({}, true);
    const voided = await add({ merchantName: "Mistake" });
    await voidTransaction(testDb(), userId, voided.id, "entered twice");
    expect(await sync()).toEqual({ status: "synced", rows: 0 });
    const id = (await conn()).spreadsheetId!;
    expect(google.tab(id)).toEqual([TRANSACTION_HEADERS]);
    expect(google.book(id).tabs[0].rowCount).toBe(2);
  });

  it("does nothing when nothing changed, and rewrites when something did", async () => {
    await add({});
    await sync();
    google.calls = [];
    expect(await sync()).toEqual({ status: "unchanged" });
    expect(google.calls).toEqual([]);

    await add({ merchantName: "Zomato" });
    expect(await sync()).toEqual({ status: "synced", rows: 2 });
  });

  it("rewrites when a category is renamed", async () => {
    await add({});
    await sync();
    await updateCategory(testDb(), userId, food, { name: "Eating out" });
    expect(await sync()).toEqual({ status: "synced", rows: 1 });
    expect(google.tab((await conn()).spreadsheetId!)[1][col("Category")]).toBe("Eating out");
  });

  it("shrinks the tab when transactions are voided, leaving no stale rows", async () => {
    const a = await add({ merchantName: "A" });
    await add({ merchantName: "B" });
    await add({ merchantName: "C" });
    await sync();
    await voidTransaction(testDb(), userId, a.id, "duplicate");
    await sync();
    const id = (await conn()).spreadsheetId!;
    expect(google.tab(id)).toHaveLength(3);
    expect(google.book(id).tabs[0].rowCount).toBe(3);
    expect(google.tab(id).map((r) => r[col("Merchant")])).not.toContain("A");
  });

  it("is idempotent: repeated syncs never duplicate rows", async () => {
    await add({});
    await add({ merchantName: "Other" });
    await sync(true);
    await sync(true);
    await sync(true);
    const id = (await conn()).spreadsheetId!;
    expect(google.books.size).toBe(1);
    expect(google.tab(id)).toHaveLength(3);
  });

  it("creates a new spreadsheet if the old one was deleted", async () => {
    await add({});
    await sync();
    const first = (await conn()).spreadsheetId!;
    google.books.delete(first);
    expect(await sync(true)).toEqual({ status: "synced", rows: 1 });
    const second = (await conn()).spreadsheetId!;
    expect(second).not.toBe(first);
    expect(google.tab(second)).toHaveLength(2);
  });

  it("adds the Transactions tab back if it was deleted", async () => {
    await add({});
    await sync();
    const book = google.book((await conn()).spreadsheetId!);
    book.tabs = [];
    await sync(true);
    expect(google.tab(book.id)).toHaveLength(2);
  });
});

describe("failures and retries", () => {
  it("backs off after a temporary failure, then recovers", async () => {
    await add({});
    google.failNext = { status: 503, message: "Backend Error" };
    const result = await sync();
    expect(result.status).toBe("failed");
    let c = await conn();
    expect(c.consecutiveFailures).toBe(1);
    expect(c.lastError).toContain("503");
    expect(c.nextAttemptAt!.getTime()).toBeGreaterThan(clock.getTime());

    expect(await sync()).toEqual({ status: "skipped", reason: "backing_off" });
    clock = new Date(c.nextAttemptAt!.getTime() + 1000);
    expect(await sync()).toEqual({ status: "synced", rows: 1 });
    c = await conn();
    expect(c.consecutiveFailures).toBe(0);
    expect(c.lastError).toBeNull();
    expect(google.books.size).toBe(1);
  });

  it("keeps retrying a setup problem (Sheets API disabled) without asking to reconnect", async () => {
    google.failNext = { status: 403, message: "Google Sheets API has not been used in project 123 before or it is disabled." };
    await sync();
    const c = await conn();
    expect(c.status).toBe("connected");
    expect(c.lastError).toContain("API has not been used");
  });

  it("asks for reconnection when Google rejects the token", async () => {
    google.refreshRejected = true;
    expect((await sync()).status).toBe("failed");
    const c = await conn();
    expect(c.status).toBe("needs_reauth");
    expect(await sync(true)).toEqual({ status: "skipped", reason: "not_connected" });

    // Reconnecting rewrites the same spreadsheet in full.
    google.refreshRejected = false;
    await saveSheetsConnection(testDb(), userId, { refreshToken: "new-token", scope: SHEETS_SCOPE, emailAddress: "sheets-owner@gmail.example" }, config);
    expect((await sync()).status).toBe("synced");
  });
});

it("never stores Google's error details beyond 300 characters", async () => {
  google.failNext = { status: 500, message: "x".repeat(2000) };
  await sync();
  const [row] = await testDb().select().from(sheetsConnections).where(eq(sheetsConnections.userId, userId));
  expect(row.lastError!.length).toBeLessThanOrEqual(300);
});
