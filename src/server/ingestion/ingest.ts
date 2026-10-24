import "server-only";
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import type { AccountType, CaptureMethod } from "@/lib/finance-types";
import { paiseToDecimal } from "@/lib/money";
import type { Database } from "@/server/db/client";
import { financialAccounts, transactions } from "@/server/db/schema";
import { createAccount } from "@/server/finance/accounts-service";
import { createTransaction } from "@/server/finance/transactions-service";
import type { ParsedAlert } from "./email/types";

// What any capture source has established about one payment. Source-agnostic: the Gmail adapter
// produces it from an alert email, and later adapters (iPhone Shortcut, statements) do the same.
export type CapturedEvent = Omit<ParsedAlert, "parserId"> & { paymentApp?: string | null };

export type IngestResult = { transactionId: string; matchStatus: "created" | "matched_existing" | "possible_duplicate" };

const normalizeInstitution = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// Finds the user's account that the alert refers to, or creates it from what the alert states
// (institution, card or account type, last digits). Never guesses between several candidates.
export async function resolveAccount(
  db: Database,
  userId: string,
  e: Pick<CapturedEvent, "institutionKey" | "institutionName" | "accountType" | "accountLast">,
): Promise<{ id: string; created: boolean } | null> {
  if (!e.accountLast) return null;
  const accounts = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.accountType, e.accountType as AccountType)));
  const sameDigits = accounts.filter((a) => a.maskedIdentifier && (a.maskedIdentifier.endsWith(e.accountLast!) || e.accountLast!.endsWith(a.maskedIdentifier)));
  const sameBank = sameDigits.filter((a) => normalizeInstitution(a.institutionName).includes(e.institutionKey));
  if (sameBank.length === 1) return { id: sameBank[0].id, created: false };
  if (sameBank.length === 0 && sameDigits.length === 1) return { id: sameDigits[0].id, created: false };
  if (sameBank.length > 1 || sameDigits.length > 1) return null; // ambiguous: leave the account unknown for review

  const digits = /^\d{2,6}$/.test(e.accountLast) ? e.accountLast : null;
  const account = await createAccount(db, userId, {
    institutionName: e.institutionName,
    accountName: e.accountType === "credit_card" ? "Credit Card" : "Account",
    accountType: e.accountType,
    maskedIdentifier: digits,
  });
  return { id: account.id, created: true };
}

export async function ingestEvent(
  db: Database,
  userId: string,
  e: CapturedEvent,
  opts: { captureMethod: CaptureMethod; deduplicationKey: string },
): Promise<IngestResult> {
  const account = await resolveAccount(db, userId, e);

  // The same payment reported again with the same reference (e.g. a duplicate alert).
  if (e.referenceId) {
    const [same] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.referenceId, e.referenceId),
          eq(transactions.amount, paiseToDecimal(e.amountPaise)),
          isNull(transactions.voidedAt),
        ),
      )
      .limit(1);
    if (same) return { transactionId: same.id, matchStatus: "matched_existing" };
  }

  // A transaction already recorded another way (manual entry, another source) that looks like this one.
  const reviewReasons = [...e.uncertain];
  let possibleDuplicate = false;
  if (account) {
    const [similar] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.financialAccountId, account.id),
          eq(transactions.amount, paiseToDecimal(e.amountPaise)),
          eq(transactions.direction, e.direction),
          ne(transactions.captureMethod, opts.captureMethod),
          isNull(transactions.voidedAt),
          gte(transactions.transactionDate, addDays(e.transactionDate, -1)),
          lte(transactions.transactionDate, addDays(e.transactionDate, 1)),
        ),
      )
      .limit(1);
    if (similar) {
      possibleDuplicate = true;
      reviewReasons.push("possible duplicate of a transaction already recorded");
    }
  } else if (e.accountLast) {
    reviewReasons.push("more than one account matches the card or account digits");
  }

  const { transaction, created } = await createTransaction(
    db,
    userId,
    {
      financialAccountId: account?.id ?? null,
      transactionDate: e.transactionDate,
      sourceTimestamp: e.sourceTimestamp,
      merchantName: e.merchant,
      originalDescription: e.description,
      amountPaise: e.amountPaise,
      currency: e.currency,
      direction: e.direction,
      transactionType: e.transactionType,
      transactionStatus: e.status,
      paymentMethod: e.paymentMethod,
      paymentApp: e.paymentApp ?? null,
      referenceId: e.referenceId,
      deduplicationKey: opts.deduplicationKey,
    },
    { captureMethod: opts.captureMethod, reviewReasons },
  );
  if (!created) return { transactionId: transaction.id, matchStatus: "matched_existing" };
  return { transactionId: transaction.id, matchStatus: possibleDuplicate ? "possible_duplicate" : "created" };
}
