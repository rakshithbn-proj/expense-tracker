import { describe, expect, it } from "vitest";
import { spendingEffect, summarize, type LedgerTransaction, type ParentInfo } from "@/server/finance/accounting";

let n = 0;
const tx = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: `t${++n}`,
  amountPaise: 1000_00,
  currency: "INR",
  direction: "debit",
  type: "purchase",
  status: "posted",
  categoryId: "food",
  parentTransactionId: null,
  voided: false,
  ...overrides,
});

const sum = (txs: LedgerTransaction[], parents: [string, ParentInfo][] = []) => summarize(txs, new Map(parents));

describe("spending rules (spec section 8)", () => {
  it("8.1 a card purchase plus its bill payment counts once", () => {
    const purchase = tx({ amountPaise: 2000_00, categoryId: "groceries" });
    const bankDebit = tx({ amountPaise: 2000_00, type: "card_settlement", direction: "debit", categoryId: null });
    const cardCredit = tx({ amountPaise: 2000_00, type: "card_settlement", direction: "credit", categoryId: null });
    const s = sum([purchase, bankDebit, cardCredit]);
    expect(s.netSpendPaise).toBe(2000_00);
    expect(s.cardSettlementPaidPaise).toBe(2000_00);
  });

  it("8.2 own-account transfers are not spending but appear in cash flow", () => {
    const s = sum([
      tx({ type: "internal_transfer", direction: "debit", amountPaise: 10_000_00 }),
      tx({ type: "internal_transfer", direction: "credit", amountPaise: 10_000_00 }),
    ]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.internalTransferOutPaise).toBe(10_000_00);
  });

  it("8.3 a linked refund reduces the original category, even if the refund is labelled differently", () => {
    const purchase = tx({ id: "p", amountPaise: 1899_00, categoryId: "shopping" });
    const refund = tx({ type: "refund", direction: "credit", amountPaise: 1899_00, categoryId: "other", parentTransactionId: "p" });
    const s = sum([purchase, refund], [["p", { categoryId: "shopping" }]]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.byCategory.shopping).toBe(0);
    expect(s.byCategory.other).toBeUndefined();
    expect(s.refundsPaise).toBe(1899_00);
  });

  it("8.3 a refund in a later month reduces that month's spending in the original category", () => {
    const refund = tx({ type: "refund", direction: "credit", amountPaise: 500_00, parentTransactionId: "old" });
    const s = sum([refund], [["old", { categoryId: "shopping" }]]);
    expect(s.byCategory.shopping).toBe(-500_00);
    expect(s.netSpendPaise).toBe(-500_00);
  });

  it("8.3 an unlinked refund still reduces spending in its own category", () => {
    const s = sum([tx({ type: "refund", direction: "credit", amountPaise: 300_00, categoryId: null })]);
    expect(s.byCategory.uncategorized).toBe(-300_00);
  });

  it("8.4 failed payments never count", () => {
    expect(sum([tx({ status: "failed" })]).netSpendPaise).toBe(0);
  });

  it("8.4 a linked reversal cancels the original exactly once", () => {
    const original = tx({ id: "o", status: "reversed", amountPaise: 999_00 });
    const reversal = tx({ type: "reversal", direction: "credit", amountPaise: 999_00, parentTransactionId: "o" });
    const s = sum([original, reversal], [["o", { categoryId: "food" }]]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.grossSpendPaise).toBe(0);
    expect(s.refundsPaise).toBe(0);
  });

  it("8.4 an unlinked reversal offsets the still-counted original (net zero, not negative)", () => {
    const original = tx({ amountPaise: 999_00, categoryId: "food" });
    const reversal = tx({ type: "reversal", direction: "credit", amountPaise: 999_00, categoryId: "food" });
    expect(sum([original, reversal]).netSpendPaise).toBe(0);
  });

  it("8.5 investments are tracked separately, not as spending", () => {
    const s = sum([tx({ type: "investment", amountPaise: 5000_00, categoryId: "investments" })]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.investmentPaise).toBe(5000_00);
  });

  it("8.6 cash withdrawals are tracked separately, not assigned to a category", () => {
    const s = sum([tx({ type: "cash_withdrawal", amountPaise: 2000_00, categoryId: null })]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.cashWithdrawalPaise).toBe(2000_00);
  });

  it("8.7 fees and interest are genuine spending", () => {
    expect(sum([tx({ type: "fee", amountPaise: 499_00, categoryId: "bills" })]).netSpendPaise).toBe(499_00);
  });

  it("8.8 pending spending counts and is reported separately", () => {
    const s = sum([tx({ status: "pending", amountPaise: 450_00 }), tx({ amountPaise: 100_00 })]);
    expect(s.grossSpendPaise).toBe(550_00);
    expect(s.pendingSpendPaise).toBe(450_00);
  });

  it("8.9 uncategorized spending is kept, not dropped", () => {
    expect(sum([tx({ categoryId: null, amountPaise: 750_00 })]).byCategory.uncategorized).toBe(750_00);
  });

  it("income is never spending", () => {
    const s = sum([tx({ type: "income", direction: "credit", amountPaise: 85_000_00 })]);
    expect(s.netSpendPaise).toBe(0);
    expect(s.incomePaise).toBe(85_000_00);
  });

  it("voided entries are ignored entirely", () => {
    const s = sum([tx({ voided: true }), tx({ type: "income", direction: "credit", voided: true })]);
    expect(s.transactionCount).toBe(0);
    expect(s.netSpendPaise).toBe(0);
    expect(s.incomePaise).toBe(0);
  });

  it("foreign-currency entries are excluded from INR totals and counted", () => {
    const s = sum([tx({ currency: "USD" }), tx({ amountPaise: 100_00 })]);
    expect(s.netSpendPaise).toBe(100_00);
    expect(s.excludedForeignCurrencyCount).toBe(1);
  });

  it("a mixed month adds up to gross minus refunds", () => {
    const s = sum(
      [
        tx({ id: "a", amountPaise: 1000_00, categoryId: "food" }),
        tx({ amountPaise: 2500_00, categoryId: "shopping" }),
        tx({ type: "refund", direction: "credit", amountPaise: 400_00, parentTransactionId: "a" }),
        tx({ type: "card_settlement", direction: "debit", amountPaise: 3500_00 }),
        tx({ type: "internal_transfer", direction: "debit", amountPaise: 9000_00 }),
        tx({ status: "failed", amountPaise: 7777_00 }),
      ],
      [["a", { categoryId: "food" }]],
    );
    expect(s.grossSpendPaise).toBe(3500_00);
    expect(s.refundsPaise).toBe(400_00);
    expect(s.netSpendPaise).toBe(3100_00);
    expect(s.byCategory).toEqual({ food: 600_00, shopping: 2500_00 });
    expect(Object.values(s.byCategory).reduce((a, b) => a + b, 0)).toBe(s.netSpendPaise);
  });

  it("spendingEffect rejects nonsense directions defensively", () => {
    expect(spendingEffect(tx({ type: "purchase", direction: "credit" }))).toBeNull();
  });
});
