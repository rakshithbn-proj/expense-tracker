// The single implementation of the accounting rules (spec section 8, ADR-0006).
// Every total shown anywhere in the app must come from these functions.
import type { Direction, TransactionStatus, TransactionType } from "@/lib/finance-types";

export type LedgerTransaction = {
  id: string;
  amountPaise: number; // always positive
  currency: string;
  direction: Direction;
  type: TransactionType;
  status: TransactionStatus;
  categoryId: string | null;
  parentTransactionId: string | null;
  voided: boolean;
};

export type ParentInfo = { categoryId: string | null };

export const UNCATEGORIZED = "uncategorized" as const;

// How one transaction changes consumption spending, attributed to a category.
// Positive adds spending, negative reduces it, null means "not spending".
export function spendingEffect(
  tx: LedgerTransaction,
  parent?: ParentInfo,
): { categoryId: string | null; amountPaise: number } | null {
  if (tx.voided) return null;
  // Failed payments never moved money. A reversed original is cancelled by its reversal.
  if (tx.status === "failed" || tx.status === "reversed") return null;

  switch (tx.type) {
    case "purchase":
    case "fee":
      return tx.direction === "debit" ? { categoryId: tx.categoryId, amountPaise: tx.amountPaise } : null;

    case "refund":
      // A linked refund reduces spending in the ORIGINAL purchase's category.
      return { categoryId: parent ? parent.categoryId : tx.categoryId, amountPaise: -tx.amountPaise };

    case "reversal":
      // A linked reversal marks its parent "reversed", which already removes the parent's
      // spending, so the reversal itself must not subtract it a second time.
      // An unlinked reversal credit still undoes spending somewhere; it subtracts in its own
      // category and is flagged for review when created.
      return parent ? null : { categoryId: tx.categoryId, amountPaise: -tx.amountPaise };

    // Not consumption: own-account transfers, card bill payments, income, investments and
    // cash withdrawals are reported separately (cash-flow, investment and cash totals).
    case "internal_transfer":
    case "card_settlement":
    case "income":
    case "investment":
    case "cash_withdrawal":
    case "other":
      return null;
  }
}

export type PeriodSummary = {
  currency: "INR";
  grossSpendPaise: number;
  refundsPaise: number; // refunds and unlinked reversals, as a positive number
  netSpendPaise: number;
  pendingSpendPaise: number; // part of gross spending still pending
  byCategory: Record<string, number>; // net spending per category id (or "uncategorized")
  incomePaise: number;
  investmentPaise: number;
  cashWithdrawalPaise: number;
  internalTransferOutPaise: number;
  cardSettlementPaidPaise: number;
  transactionCount: number;
  excludedForeignCurrencyCount: number;
};

// Summarizes transactions that fall in one period. `parents` must contain every
// parent referenced by a refund or reversal in `txs`, wherever its own date falls.
export function summarize(txs: LedgerTransaction[], parents: Map<string, ParentInfo>): PeriodSummary {
  const s: PeriodSummary = {
    currency: "INR",
    grossSpendPaise: 0,
    refundsPaise: 0,
    netSpendPaise: 0,
    pendingSpendPaise: 0,
    byCategory: {},
    incomePaise: 0,
    investmentPaise: 0,
    cashWithdrawalPaise: 0,
    internalTransferOutPaise: 0,
    cardSettlementPaidPaise: 0,
    transactionCount: 0,
    excludedForeignCurrencyCount: 0,
  };

  for (const tx of txs) {
    if (tx.voided) continue;
    if (tx.currency !== "INR") {
      s.excludedForeignCurrencyCount++;
      continue;
    }
    s.transactionCount++;

    const parent = tx.parentTransactionId ? parents.get(tx.parentTransactionId) : undefined;
    const effect = spendingEffect(tx, parent);
    if (effect) {
      const key = effect.categoryId ?? UNCATEGORIZED;
      s.byCategory[key] = (s.byCategory[key] ?? 0) + effect.amountPaise;
      if (effect.amountPaise > 0) {
        s.grossSpendPaise += effect.amountPaise;
        if (tx.status === "pending") s.pendingSpendPaise += effect.amountPaise;
      } else {
        s.refundsPaise += -effect.amountPaise;
      }
    }

    if (tx.status === "failed" || tx.status === "reversed") continue;
    if (tx.type === "income") s.incomePaise += tx.amountPaise;
    if (tx.type === "investment") s.investmentPaise += tx.amountPaise;
    if (tx.type === "cash_withdrawal") s.cashWithdrawalPaise += tx.amountPaise;
    if (tx.type === "internal_transfer" && tx.direction === "debit") s.internalTransferOutPaise += tx.amountPaise;
    if (tx.type === "card_settlement" && tx.direction === "debit") s.cardSettlementPaidPaise += tx.amountPaise;
  }

  s.netSpendPaise = s.grossSpendPaise - s.refundsPaise;
  return s;
}
