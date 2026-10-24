import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { financialAccounts, gmailConnections, sourceHealth, transactionSources, transactions, users } from "@/server/db/schema";
import type { GmailConfig } from "@/server/env";
import { createAccount } from "@/server/finance/accounts-service";
import { createTransaction } from "@/server/finance/transactions-service";
import { GMAIL_SCOPE } from "@/server/ingestion/gmail/client";
import { disconnect, maskExcerpt, processQueue, runCycle, saveConnection, syncGmail } from "@/server/ingestion/gmail/service";
import { claimBatch, MAX_ATTEMPTS, purgeExpiredPayloads, resetForRetry } from "@/server/ingestion/queue";
import { createOwner } from "@/server/users";
import { closeTestDb, resetDb, testDb } from "../support/db";
import { loadEmailFixtures, toGmailMessage } from "../support/email-fixtures";
import { FakeGoogle } from "../support/fake-google";

const fixtures = loadEmailFixtures();
const config: GmailConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3000/api/gmail/callback",
  encryptionKey: randomBytes(32),
  backfillDays: 3650,
};

let userId: string;
let google: FakeGoogle;
let clock: Date;
const deps = () => ({ config, fetchImpl: google.fetch, now: () => clock });

const sources = () => testDb().select().from(transactionSources).where(eq(transactionSources.userId, userId));
const txs = () => testDb().select().from(transactions).where(eq(transactions.userId, userId));
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

async function connect() {
  await saveConnection(testDb(), userId, { emailAddress: "owner@gmail.example", refreshToken: "refresh-secret-123", scope: GMAIL_SCOPE }, config);
}

beforeEach(async () => {
  await resetDb();
  userId = (await createOwner(testDb(), "owner@example.com", "a-long-test-password")).id;
  google = new FakeGoogle();
  clock = new Date("2026-10-22T12:00:00Z");
  fixtures.forEach((f, i) => google.add(toGmailMessage(f, `msg-${i}`)));
});
afterAll(closeTestDb);

describe("connecting", () => {
  it("stores the refresh token encrypted, never in plain text", async () => {
    await connect();
    const [row] = await testDb().select().from(gmailConnections);
    expect(row.refreshTokenEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain("refresh-secret-123");
  });

  it("refuses a grant without Gmail read access", async () => {
    await expect(saveConnection(testDb(), userId, { emailAddress: "x@y", refreshToken: "t", scope: "openid email" }, config)).rejects.toThrow(/not granted/);
  });

  it("disconnecting revokes at Google and deletes the token", async () => {
    await connect();
    await disconnect(testDb(), userId, deps());
    const [row] = await testDb().select().from(gmailConnections);
    expect(google.revoked).toEqual(["refresh-secret-123"]);
    expect(row).toMatchObject({ refreshTokenEncrypted: null, status: "disconnected" });
  });
});

describe("capturing real alert formats end to end", () => {
  it("syncs, parses and records every fixture as an automatic transaction on the right card", async () => {
    await connect();
    const result = await runCycle(testDb(), deps());
    expect(result).toEqual({ queued: fixtures.length, processed: fixtures.length });

    const all = await txs();
    expect(all).toHaveLength(fixtures.length);
    expect(new Set(all.map((t) => t.captureMethod))).toEqual(new Set(["auto_email"]));
    expect(all.map((t) => t.deduplicationKey).sort()).toEqual(fixtures.map((_, i) => `gmail:msg-${i}`).sort());

    const accounts = await testDb().select().from(financialAccounts).where(eq(financialAccounts.userId, userId));
    expect(accounts.map((a) => `${a.institutionName} ••${a.maskedIdentifier}`).sort()).toEqual(
      ["HDFC Bank ••4321", "HDFC Bank ••7788", "HSBC ••1122", "ICICI Bank ••3344", "RBL Bank ••6060"].sort(),
    );

    const upi = all.find((t) => t.referenceId === "600000000001")!;
    expect(upi).toMatchObject({ paymentMethod: "upi", amount: "245.50", paymentApp: null });

    // Provenance is kept; email bodies are not.
    for (const s of await sources()) {
      expect(s).toMatchObject({ parseStatus: "parsed", matchStatus: "created" });
      expect(Object.keys(s.payload as object).sort()).toEqual(["from", "subject"]);
      expect(s.rawPayloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(s.receivedAt).not.toBeNull();
    }
    const [health] = await testDb().select().from(sourceHealth);
    expect(health).toMatchObject({ status: "operational", consecutiveFailures: 0 });
  });

  it("is idempotent: re-syncing and re-processing never duplicates a transaction", async () => {
    await connect();
    await runCycle(testDb(), deps());
    advance(60_000);
    expect(await runCycle(testDb(), deps())).toEqual({ queued: 0, processed: 0 });

    // Force the same emails through processing again.
    await testDb().update(transactionSources).set({ parseStatus: "failed" });
    await resetForRetry(testDb(), userId, "all-failed", clock);
    await processQueue(testDb(), deps());
    expect(await txs()).toHaveLength(fixtures.length);
    expect(new Set((await sources()).map((s) => s.matchStatus))).toEqual(new Set(["matched_existing"]));
  });

  it("uses an existing account with matching digits instead of creating one", async () => {
    await createAccount(testDb(), userId, { institutionName: "HDFC Bank", accountName: "Diners Black", accountType: "credit_card", maskedIdentifier: "7788" });
    await connect();
    await runCycle(testDb(), deps());
    const hdfc = await testDb()
      .select()
      .from(financialAccounts)
      .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.maskedIdentifier, "7788")));
    expect(hdfc).toHaveLength(1);
    expect(hdfc[0].accountName).toBe("Diners Black");
  });

  it("flags a possible duplicate of a manual entry instead of silently doubling it", async () => {
    const card = await createAccount(testDb(), userId, { institutionName: "RBL Bank", accountName: "Card", accountType: "credit_card", maskedIdentifier: "6060" });
    await createTransaction(
      testDb(),
      userId,
      { transactionDate: "2026-10-11", amountPaise: 100000, direction: "debit", transactionType: "purchase", financialAccountId: card.id },
      { captureMethod: "manual" },
    );
    await connect();
    await runCycle(testDb(), deps());
    const rbl = (await sources()).find((s) => s.parserId === "rbl.card")!;
    expect(rbl.matchStatus).toBe("possible_duplicate");
    const [captured] = await testDb().select().from(transactions).where(eq(transactions.id, rbl.transactionId!));
    expect(captured.needsReview).toBe(true);
    expect(captured.reviewReason).toMatch(/possible duplicate/);
  });
});

describe("nothing is lost", () => {
  const known = fixtures.find((f) => f.file.startsWith("hdfc/"))!;

  it("an unreadable alert from a bank goes to review with a masked excerpt that expires", async () => {
    const changed = toGmailMessage({ ...known, html: "<p>Rs. 999.00 charged on card 7788 for order 123456789 at NEWSHOP</p>" }, "msg-changed");
    google.messages = new Map([[changed.id, changed]]);
    await connect();
    await runCycle(testDb(), deps());
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "unrecognized", errorCode: "no_template" });
    const excerpt = (s.payload as { excerpt: string }).excerpt;
    expect(excerpt).toContain("Rs. 999.00");
    expect(excerpt).not.toContain("123456789");
    expect(s.purgePayloadAfter!.getTime()).toBe(clock.getTime() + 7 * 86_400_000);
    expect(await txs()).toHaveLength(0);

    advance(8 * 86_400_000);
    await purgeExpiredPayloads(testDb(), clock);
    expect((await sources())[0].payload).toBeNull();
  });

  it("a forged bank alert never becomes a transaction", async () => {
    const forged = toGmailMessage(known, "msg-forged", ["mx.google.com; dkim=pass header.i=@attacker.example; dmarc=fail header.from=hdfcbank.bank.in"]);
    google.messages = new Map([[forged.id, forged]]);
    await connect();
    await runCycle(testDb(), deps());
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "unrecognized", errorCode: "unauthenticated_sender" });
    expect(s.lastError).toMatch(/Sender not verified/);
    expect(await txs()).toHaveLength(0);
  });

  it("promotional mail from a bank sender is ignored and nothing is kept", async () => {
    const promo = toGmailMessage({ ...known, subject: "Festive offers", html: "<p>Apply for a new card today and enjoy rewards.</p>" }, "msg-promo");
    google.messages = new Map([[promo.id, promo]]);
    await connect();
    await runCycle(testDb(), deps());
    expect((await sources())[0]).toMatchObject({ parseStatus: "not_transaction", payload: null });
  });

  it("retries temporary Gmail failures with backoff, then succeeds", async () => {
    google.messages = new Map([["msg-0", toGmailMessage(fixtures[0], "msg-0")]]);
    google.failNextGets = 1;
    await connect();
    await runCycle(testDb(), deps());
    let [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "pending", attempts: 1, errorCode: "temporarily_failing" });
    expect(s.nextAttemptAt.getTime()).toBe(clock.getTime() + 2 * 60_000);

    await processQueue(testDb(), deps()); // not due yet
    expect((await sources())[0].parseStatus).toBe("pending");
    advance(2 * 60_000);
    await processQueue(testDb(), deps());
    [s] = await sources();
    expect(s.parseStatus).toBe("parsed");
    expect(await txs()).toHaveLength(1);
  });

  it("gives up after repeated failures and shows the item for a manual retry", async () => {
    google.messages = new Map([["msg-0", toGmailMessage(fixtures[0], "msg-0")]]);
    google.failNextGets = 100;
    await connect();
    await syncGmail(testDb(), userId, deps());
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await processQueue(testDb(), deps());
      advance(7 * 3_600_000);
    }
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "failed", attempts: MAX_ATTEMPTS });

    google.failNextGets = 0;
    expect(await resetForRetry(testDb(), userId, [s.id], clock)).toBe(1);
    await processQueue(testDb(), deps());
    expect((await sources())[0].parseStatus).toBe("parsed");
  });

  it("revoked Google access pauses capture without using up retries", async () => {
    await connect();
    await syncGmail(testDb(), userId, deps());
    google.refreshRejected = true;
    await processQueue(testDb(), deps());
    const [conn] = await testDb().select().from(gmailConnections);
    expect(conn.status).toBe("needs_reauth");
    const [health] = await testDb().select().from(sourceHealth);
    expect(health.status).toBe("awaiting_authorization");
    for (const s of await sources()) expect(s).toMatchObject({ parseStatus: "pending", attempts: 0 });
    expect(await syncGmail(testDb(), userId, deps())).toEqual({ queued: 0, scanned: 0 });
  });

  it("reclaims work from a worker that crashed mid-processing", async () => {
    await connect();
    await syncGmail(testDb(), userId, deps());
    const claimed = await claimBatch(testDb(), 100, clock); // a worker claims, then dies
    expect(claimed).toHaveLength(fixtures.length);
    expect(await claimBatch(testDb(), 100, clock)).toHaveLength(0); // locked meanwhile
    advance(6 * 60_000);
    await processQueue(testDb(), deps(), 100);
    expect(await txs()).toHaveLength(fixtures.length);
  });

  it("catches up after downtime using an overlapping window", async () => {
    await connect();
    await runCycle(testDb(), deps());
    const lastSync = clock;
    advance(5 * 86_400_000); // five days offline
    const late = toGmailMessage({ ...fixtures[0], date: new Date(clock.getTime() - 3 * 86_400_000).toISOString() }, "msg-late");
    google.add(late);
    await runCycle(testDb(), deps());
    const lastQuery = google.queries.at(-1)!;
    expect(lastQuery).toContain(`after:${Math.floor((lastSync.getTime() - 2 * 86_400_000) / 1000)}`);
    expect((await sources()).some((s) => s.sourceMessageId === "msg-late" && s.parseStatus === "parsed")).toBe(true);
  });
});

describe("isolation and privacy", () => {
  it("one user's retry can't touch another user's queue", async () => {
    await connect();
    await testDb().insert(transactionSources).values({ userId, sourceType: "gmail", sourceMessageId: "x", parseStatus: "failed" });
    const [other] = await testDb().insert(users).values({ email: "other@example.com", passwordHash: "x" }).returning();
    expect(await resetForRetry(testDb(), other.id, "all-failed")).toBe(0);
  });

  it("masks long numbers in excerpts but keeps amounts readable", () => {
    expect(maskExcerpt("Rs. 1,000.00 ref 665551359923 card 4321")).toBe("Rs. 1,000.00 ref ••••••••9923 card 4321");
  });

  it("never keeps any digit of an OTP, PIN or password", () => {
    expect(maskExcerpt("OTP: 120863 valid 5 min")).toBe("OTP: •••• valid 5 min");
    expect(maskExcerpt("Your one-time password is 4821")).toBe("Your one-time password is ••••");
    expect(maskExcerpt("PIN 9876")).toBe("PIN ••••");
    expect(maskExcerpt("SHOPPING 12345")).toBe("SHOPPING •2345");
  });

  it("stores nothing at all from an OTP email", async () => {
    const otp = toGmailMessage(
      { ...fixtures.find((f) => f.file.startsWith("hsbc/"))!, subject: "Your HSBC Credit Card OTP", html: "<p>A One-Time Password (OTP) has been generated. OTP: 123456. Amount: INR 100.00</p>" },
      "msg-otp",
    );
    google.messages = new Map([[otp.id, otp]]);
    await connect();
    await runCycle(testDb(), deps());
    const [s] = await sources();
    expect(s).toMatchObject({ parseStatus: "not_transaction", payload: null });
    expect(JSON.stringify(s)).not.toContain("123456");
    expect(await txs()).toHaveLength(0);
  });
});
