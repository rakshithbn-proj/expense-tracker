// Candidate matching for refunds and own-account transfers. Matches are only applied
// automatically when exactly one candidate is clearly best; otherwise the user reviews.
import type { AccountType, Direction, TransactionStatus, TransactionType } from "@/lib/finance-types";
import { daysBetween } from "@/lib/dates";

export type MatchableTransaction = {
  id: string;
  financialAccountId: string | null;
  transactionDate: string;
  amountPaise: number;
  direction: Direction;
  type: TransactionType;
  status: TransactionStatus;
  merchantNormalized: string | null;
  transferGroupId: string | null;
  voided: boolean;
};

export type ScoredCandidate = { id: string; score: number; reasons: string[] };

export const REFUND_LOOKBACK_DAYS = 180;
const CONFIDENT_REFUND_SCORE = 5;

// `remainingPaise` is the original amount minus refunds already linked to it.
export function scoreRefundCandidates(
  refund: MatchableTransaction,
  candidates: (MatchableTransaction & { remainingPaise: number })[],
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const c of candidates) {
    if (c.id === refund.id || c.voided) continue;
    if (c.direction !== "debit" || (c.type !== "purchase" && c.type !== "fee")) continue;
    if (c.status !== "posted" && c.status !== "pending") continue;
    const age = daysBetween(c.transactionDate, refund.transactionDate);
    if (age < 0 || age > REFUND_LOOKBACK_DAYS) continue;
    if (c.remainingPaise < refund.amountPaise) continue;

    const sameMerchant = !!refund.merchantNormalized && refund.merchantNormalized === c.merchantNormalized;
    const sameAccount = !!refund.financialAccountId && refund.financialAccountId === c.financialAccountId;
    // Without a shared merchant or account there is no evidence the two are related.
    if (!sameMerchant && !sameAccount) continue;

    const signals: [boolean, number, string][] = [
      [sameMerchant, 3, "same merchant"],
      [sameAccount, 2, "same account"],
      [c.amountPaise === refund.amountPaise, 3, "same amount"],
      [age <= 30, 1, "within 30 days"],
    ];
    const hits = signals.filter(([hit]) => hit);
    out.push({
      id: c.id,
      score: hits.reduce((sum, [, points]) => sum + points, 0),
      reasons: hits.map(([, , reason]) => reason),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Returns the single best candidate only if it is confident and unambiguous.
export function pickConfident(candidates: ScoredCandidate[], minScore = CONFIDENT_REFUND_SCORE): ScoredCandidate | null {
  const [best, second] = candidates;
  if (!best || best.score < minScore) return null;
  if (second && second.score === best.score) return null;
  return best;
}

export const TRANSFER_WINDOW_DAYS = 3;
const TRANSFERABLE: TransactionType[] = ["purchase", "income", "other", "internal_transfer", "card_settlement"];

// Finds the other side of a possible own-account transfer: an opposite-direction entry of the
// same amount, on a DIFFERENT account the user owns, within a few days. If the receiving side
// is a credit card it is a card settlement. Only an unambiguous single match is returned.
export function findTransferCounterpart(
  tx: MatchableTransaction,
  candidates: MatchableTransaction[],
  accountTypes: Map<string, AccountType>,
): { counterpartId: string; kind: "internal_transfer" | "card_settlement" } | null {
  if (!tx.financialAccountId || tx.voided || tx.transferGroupId) return null;
  const matches = candidates.filter(
    (c) =>
      c.id !== tx.id &&
      !c.voided &&
      !c.transferGroupId &&
      c.financialAccountId !== null &&
      c.financialAccountId !== tx.financialAccountId &&
      accountTypes.has(c.financialAccountId) &&
      c.direction !== tx.direction &&
      c.amountPaise === tx.amountPaise &&
      c.status !== "failed" &&
      TRANSFERABLE.includes(c.type) &&
      Math.abs(daysBetween(c.transactionDate, tx.transactionDate)) <= TRANSFER_WINDOW_DAYS,
  );
  if (matches.length !== 1) return null;

  const counterpart = matches[0];
  const creditSide = tx.direction === "credit" ? tx : counterpart;
  const kind = accountTypes.get(creditSide.financialAccountId!) === "credit_card" ? "card_settlement" : "internal_transfer";
  return { counterpartId: counterpart.id, kind };
}
