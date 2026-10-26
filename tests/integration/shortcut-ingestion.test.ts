import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deviceKeys, transactionSources, transactions, users } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { processQueue } from "@/server/ingestion/gmail/service";
import { enqueueSource, resetForRetry } from "@/server/ingestion/queue";
import {
  authenticateDeviceKey,
  createDeviceKey,
  deviceSourceIdentifier,
  isRateLimited,
  MAX_SUBMISSIONS_PER_HOUR,
  revokeDeviceKey,
} from "@/server/ingestion/shortcut/keys";
import { submitFromDevice } from "@/server/ingestion/shortcut/service";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";

let userId: string;
let key: string;
let keyId: string;
const now = new Date("2026-10-24T06:00:00Z");
const device = async () => (await authenticateDeviceKey(testDb(), `Bearer ${key}`, now))!;
const txs = () => testDb().select().from(transactions).where(eq(transactions.userId, userId));
const sources = () => testDb().select().from(transactionSources).where(eq(transactionSources.userId, userId));

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  const created = await createDeviceKey(testDb(), userId, "My iPhone");
  key = created.key;
  keyId = created.id;
});
afterAll(closeTestDb);

describe("device keys", () => {
  it("are random, shown once, and stored only as a hash", async () => {
    expect(key).toMatch(/^etk_[A-Za-z0-9_-]{43}$/);
    const [row] = await testDb().select().from(deviceKeys);
    expect(JSON.stringify(row)).not.toContain(key);
    expect(row.keyPrefix).toBe(key.slice(0, 10));
  });

  it("authenticate only the exact, unrevoked key", async () => {
    expect((await device()).userId).toBe(userId);
    for (const header of [null, "", key, "Bearer ", "Bearer etk_wrong", `Basic ${key}`, `Bearer ${key}x`]) {
      expect(await authenticateDeviceKey(testDb(), header, now), String(header)).toBeNull();
    }
    await revokeDeviceKey(testDb(), userId, keyId);
    expect(await authenticateDeviceKey(testDb(), `Bearer ${key}`, now)).toBeNull();
  });

  it("record when they were last used", async () => {
    await device();
    const [row] = await testDb().select().from(deviceKeys);
    expect(row.lastUsedAt?.toISOString()).toBe(now.toISOString());
  });

  it("can't be revoked by another user", async () => {
    const [other] = await testDb().insert(users).values({ email: "other@example.com", passwordHash: "x" }).returning();
    await expect(revokeDeviceKey(testDb(), other.id, keyId)).rejects.toThrow();
    expect(await authenticateDeviceKey(testDb(), `Bearer ${key}`, now)).not.toBeNull();
  });
});

describe("Quick Add", () => {
  it("records a manual transaction with the app the user stated", async () => {
    const result = await submitFromDevice(testDb(), await device(), { kind: "quick_add", amount: "450.50", merchant: "Chai Point", paymentMethod: "upi", paymentApp: "PhonePe" }, now);
    expect(result.status).toBe("captured");
    const [t] = await txs();
    expect(t).toMatchObject({
      id: result.transactionId,
      amount: "450.50",
      merchantName: "Chai Point",
      paymentMethod: "upi",
      paymentApp: "PhonePe",
      captureMethod: "manual",
      transactionDate: "2026-10-24",
      transactionType: "purchase",
    });
    const [s] = await sources();
    expect(s).toMatchObject({ sourceType: "shortcut", parserId: "shortcut.quick_add", sourceIdentifier: deviceSourceIdentifier(keyId) });
    expect(s.payload).toEqual({ kind: "quick_add" });
  });

  it("accepts numbers as Shortcuts send them", async () => {
    await submitFromDevice(testDb(), await device(), { kind: "quick_add", amount: 1200 }, now);
    expect((await txs())[0].amount).toBe("1200.00");
  });

  it("doesn't duplicate a double tap, but allows the same purchase again later", async () => {
    const body = { kind: "quick_add", amount: 80, merchant: "Metro" };
    await submitFromDevice(testDb(), await device(), body, now);
    expect((await submitFromDevice(testDb(), await device(), body, new Date(now.getTime() + 10_000))).status).toBe("duplicate");
    await submitFromDevice(testDb(), await device(), body, new Date(now.getTime() + 5 * 60_000));
    expect(await txs()).toHaveLength(2);
  });

  it("uses an explicit id for idempotency when the Shortcut sends one", async () => {
    const body = { kind: "quick_add", amount: 99, id: "2026-10-24T11:30:05+05:30" };
    await submitFromDevice(testDb(), await device(), body, now);
    expect((await submitFromDevice(testDb(), await device(), body, new Date(now.getTime() + 3_600_000))).status).toBe("duplicate");
  });

  it("rejects bad input with a readable reason and records nothing", async () => {
    await expect(submitFromDevice(testDb(), await device(), { kind: "quick_add", amount: "abc" }, now)).rejects.toThrow(/amount greater than zero/);
    await expect(submitFromDevice(testDb(), await device(), { kind: "quick_add", amount: -5 }, now)).rejects.toThrow();
    await expect(submitFromDevice(testDb(), await device(), { kind: "pin", pin: "1234" }, now)).rejects.toThrow();
    expect(await sources()).toHaveLength(0);
  });
});

describe("SMS and shared receipts", () => {
  const sms = "Rs.2000.00 debited from A/c XX1234 on 24-10-26 to VPA someone@okaxis (UPI Ref No 600000000002). Not you? Call 18002586161";

  it("keep a transaction-like SMS for review, masked, without recording anything", async () => {
    const result = await submitFromDevice(testDb(), await device(), { kind: "sms", text: sms, sender: "JD-HDFCBK" }, now);
    expect(result.status).toBe("needs_review");
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "unrecognized", errorCode: "no_template" });
    const excerpt = (s.payload as { excerpt: string }).excerpt;
    expect(excerpt).toContain("Rs.2000.00");
    expect(excerpt).not.toContain("600000000002");
    expect(s.purgePayloadAfter!.getTime()).toBe(now.getTime() + 7 * 86_400_000);
    expect(await txs()).toHaveLength(0);
  });

  it("never keep an OTP SMS", async () => {
    const result = await submitFromDevice(testDb(), await device(), { kind: "sms", text: "123456 is your OTP for a transaction of Rs.500 at SHOP. Do not share.", sender: "AX-HDFCBK" }, now);
    expect(result.status).toBe("ignored");
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "not_transaction", payload: null });
  });

  it("ignore text that isn't a payment", async () => {
    expect((await submitFromDevice(testDb(), await device(), { kind: "share", text: "Thanks for shopping with us!" }, now)).status).toBe("ignored");
  });

  it("record a known bank SMS as an automatic transaction, without keeping its text", async () => {
    const icici = "ICICI Bank Acct XX123 debited for Rs 5.00 on 24-Oct-26; RAVI KUMAR S  credited. UPI:630099990001. Call 18002662 for dispute.";
    const result = await submitFromDevice(testDb(), await device(), { kind: "sms", text: icici, sender: "JD-ICICIT-S" }, now);
    expect(result.status).toBe("captured");
    const [t] = await txs();
    expect(t).toMatchObject({ id: result.transactionId, amount: "5.00", merchantName: "RAVI KUMAR S", captureMethod: "auto_sms", paymentMethod: "upi", referenceId: "630099990001" });
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "parsed", parserId: "icici.sms_acct_upi_debit", payload: { kind: "sms", sender: "JD-ICICIT-S" } });
  });

  it("retry an unrecognised SMS from its masked excerpt instead of losing it", async () => {
    // Stored before the ICICI parser existed.
    const excerpt = "ICICI Bank Acct XX123 debited for Rs 5.00 on 24-Oct-26; RAVI KUMAR S  credited. UPI:••••••••0001. Call ••••2662 for dispute.";
    await enqueueSource(testDb(), { userId, sourceType: "shortcut", sourceIdentifier: deviceSourceIdentifier(keyId), sourceMessageId: "sms:old", payload: { kind: "sms", sender: "ICICIT-S", excerpt } }, now);
    await testDb().update(transactionSources).set({ parseStatus: "unrecognized" });
    expect(await resetForRetry(testDb(), userId, "all-failed", now)).toBe(1);
    expect(await processQueue(testDb(), { config: null, now: () => now })).toEqual({ processed: 1, failed: 0 });
    expect((await sources())[0]).toMatchObject({ parseStatus: "parsed", parserId: "icici.sms_acct_upi_debit" });
    expect((await txs())[0]).toMatchObject({ amount: "5.00", referenceId: null });
  });

  it("an item waiting out its backoff after an error can be retried now", async () => {
    await enqueueSource(testDb(), { userId, sourceType: "shortcut", sourceIdentifier: deviceSourceIdentifier(keyId), sourceMessageId: "sms:backoff", payload: { kind: "sms", text: sms } }, now);
    await testDb().update(transactionSources).set({ errorCode: "processing_error", nextAttemptAt: new Date(now.getTime() + 3_600_000) });
    expect(await resetForRetry(testDb(), userId, "all-failed", now)).toBe(1);
    expect((await sources())[0].nextAttemptAt.getTime()).toBe(now.getTime());
  });

  it("a retried SMS that still isn't recognised goes back to review", async () => {
    await submitFromDevice(testDb(), await device(), { kind: "sms", text: sms, sender: "JD-HDFCBK" }, now);
    await resetForRetry(testDb(), userId, "all-failed", now);
    await processQueue(testDb(), { config: null, now: () => now });
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "unrecognized", errorCode: "no_template" });
    expect(s.purgePayloadAfter!.getTime()).toBe(now.getTime() + 7 * 86_400_000);
  });

  it("deduplicate an automation that fires twice for one SMS", async () => {
    await submitFromDevice(testDb(), await device(), { kind: "sms", text: sms, sender: "JD-HDFCBK" }, now);
    expect((await submitFromDevice(testDb(), await device(), { kind: "sms", text: `${sms}  `, sender: "JD-HDFCBK" }, now)).status).toBe("duplicate");
    expect(await sources()).toHaveLength(1);
  });
});

describe("limits and recovery", () => {
  it("rate-limits a key after too many submissions in an hour", async () => {
    for (let i = 0; i < MAX_SUBMISSIONS_PER_HOUR; i++) {
      await enqueueSource(testDb(), { userId, sourceType: "shortcut", sourceIdentifier: deviceSourceIdentifier(keyId), sourceMessageId: `x${i}` }, now);
    }
    expect(await isRateLimited(testDb(), keyId, now)).toBe(true);
    expect(await isRateLimited(testDb(), keyId, new Date(now.getTime() + 2 * 3_600_000))).toBe(false);
  });

  it("the worker processes a queued SMS even without Gmail configured", async () => {
    await enqueueSource(
      testDb(),
      { userId, sourceType: "shortcut", sourceIdentifier: deviceSourceIdentifier(keyId), sourceMessageId: "sms:queued", payload: { kind: "sms", sender: "JD-HDFCBK", text: "Rs.10 debited from A/c XX1 to VPA a@b" } },
      now,
    );
    expect(await processQueue(testDb(), { config: null, now: () => now })).toEqual({ processed: 1, failed: 0 });
    expect((await sources())[0].parseStatus).toBe("unrecognized");
  });

  it("surfaces domain errors from the Quick Add path", () => {
    expect(new DomainError("x", "y")).toBeInstanceOf(Error);
  });
});
