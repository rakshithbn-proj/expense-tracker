import { describe, expect, it } from "vitest";
import { budgetInForce, evaluateBudget } from "@/server/finance/budget";
import { findTransferCounterpart, pickConfident, scoreRefundCandidates, type MatchableTransaction } from "@/server/finance/matching";
import { nextStatus } from "@/server/finance/status";

describe("nextStatus", () => {
  it("moves pending forward", () => {
    expect(nextStatus("pending", "posted")).toMatchObject({ status: "posted", changed: true, conflict: null });
    expect(nextStatus("pending", "failed")).toMatchObject({ status: "failed", changed: true });
  });

  it("ignores duplicate alerts", () => {
    expect(nextStatus("posted", "posted")).toMatchObject({ status: "posted", changed: false, conflict: null });
  });

  it("does not let a stale pending or a late failure undo a posted payment", () => {
    expect(nextStatus("posted", "pending")).toMatchObject({ status: "posted", changed: false, conflict: null });
    const late = nextStatus("posted", "failed");
    expect(late.status).toBe("posted");
    expect(late.conflict).toMatch(/failure alert received after success/);
  });

  it("accepts success after failure but flags it", () => {
    expect(nextStatus("failed", "posted")).toMatchObject({ status: "posted", changed: true });
    expect(nextStatus("failed", "posted").conflict).not.toBeNull();
    expect(nextStatus("failed", "pending")).toMatchObject({ status: "failed", changed: false });
  });

  it("never reopens a reversed transaction", () => {
    expect(nextStatus("reversed", "posted")).toMatchObject({ status: "reversed", changed: false });
    expect(nextStatus("reversed", "posted").conflict).not.toBeNull();
  });
});

const m = (overrides: Partial<MatchableTransaction>): MatchableTransaction => ({
  id: crypto.randomUUID(),
  financialAccountId: "card",
  transactionDate: "2026-10-10",
  amountPaise: 1899_00,
  direction: "debit",
  type: "purchase",
  status: "posted",
  merchantNormalized: "AMAZON",
  transferGroupId: null,
  voided: false,
  ...overrides,
});

describe("refund matching", () => {
  const refund = m({ direction: "credit", type: "refund", transactionDate: "2026-10-15" });
  const withRemaining = (t: MatchableTransaction) => ({ ...t, remainingPaise: t.amountPaise });

  it("confidently picks a single same-merchant, same-amount purchase", () => {
    const original = m({});
    const scored = scoreRefundCandidates(refund, [withRemaining(original), withRemaining(m({ merchantNormalized: "FLIPKART", financialAccountId: "other" }))]);
    expect(scored).toHaveLength(1);
    expect(pickConfident(scored)?.id).toBe(original.id);
  });

  it("refuses to choose between two equally good purchases", () => {
    const scored = scoreRefundCandidates(refund, [withRemaining(m({})), withRemaining(m({}))]);
    expect(scored).toHaveLength(2);
    expect(pickConfident(scored)).toBeNull();
  });

  it("never matches on amount alone, or to a purchase after the refund", () => {
    expect(scoreRefundCandidates(refund, [withRemaining(m({ merchantNormalized: "OTHER", financialAccountId: "x" }))])).toHaveLength(0);
    expect(scoreRefundCandidates(refund, [withRemaining(m({ transactionDate: "2026-10-20" }))])).toHaveLength(0);
  });

  it("skips purchases already fully refunded, failed, voided or too old", () => {
    expect(scoreRefundCandidates(refund, [{ ...m({}), remainingPaise: 0 }])).toHaveLength(0);
    expect(scoreRefundCandidates(refund, [withRemaining(m({ status: "failed" }))])).toHaveLength(0);
    expect(scoreRefundCandidates(refund, [withRemaining(m({ voided: true }))])).toHaveLength(0);
    expect(scoreRefundCandidates(refund, [withRemaining(m({ transactionDate: "2026-01-01" }))])).toHaveLength(0);
  });

  it("does not auto-link a weak match (same account, different amount and merchant)", () => {
    const weak = scoreRefundCandidates(refund, [withRemaining(m({ merchantNormalized: "X", amountPaise: 5000_00 }))]);
    expect(weak).toHaveLength(1);
    expect(pickConfident(weak)).toBeNull();
  });
});

describe("transfer and settlement matching", () => {
  const types = new Map([
    ["hdfc", "bank_account" as const],
    ["sbi", "bank_account" as const],
    ["card", "credit_card" as const],
  ]);
  const debit = m({ financialAccountId: "hdfc", type: "card_settlement", amountPaise: 15_000_00, merchantNormalized: null });

  it("pairs a bank debit with the card credit as a settlement", () => {
    const credit = m({ financialAccountId: "card", direction: "credit", type: "card_settlement", amountPaise: 15_000_00 });
    expect(findTransferCounterpart(debit, [credit], types)).toEqual({ counterpartId: credit.id, kind: "card_settlement" });
  });

  it("pairs two bank accounts as an internal transfer", () => {
    const credit = m({ financialAccountId: "sbi", direction: "credit", type: "internal_transfer", amountPaise: 15_000_00 });
    expect(findTransferCounterpart(debit, [credit], types)?.kind).toBe("internal_transfer");
  });

  it("requires an account the user owns, a different account, the same amount and a close date", () => {
    const base = { direction: "credit" as const, type: "other" as const, amountPaise: 15_000_00 };
    expect(findTransferCounterpart(debit, [m({ ...base, financialAccountId: "someone-else" })], types)).toBeNull();
    expect(findTransferCounterpart(debit, [m({ ...base, financialAccountId: "hdfc" })], types)).toBeNull();
    expect(findTransferCounterpart(debit, [m({ ...base, financialAccountId: "sbi", amountPaise: 14_999_00 })], types)).toBeNull();
    expect(findTransferCounterpart(debit, [m({ ...base, financialAccountId: "sbi", transactionDate: "2026-10-20" })], types)).toBeNull();
  });

  it("refuses ambiguous pairs", () => {
    const a = m({ financialAccountId: "sbi", direction: "credit", type: "other", amountPaise: 15_000_00 });
    const b = m({ financialAccountId: "card", direction: "credit", type: "other", amountPaise: 15_000_00 });
    expect(findTransferCounterpart(debit, [a, b], types)).toBeNull();
  });
});

describe("budgets", () => {
  it("reports ok, warning and exceeded", () => {
    expect(evaluateBudget(10_000_00, 5_000_00, 80)).toMatchObject({ state: "ok", percentUsed: 50, remainingPaise: 5_000_00 });
    expect(evaluateBudget(10_000_00, 8_000_00, 80).state).toBe("warning");
    expect(evaluateBudget(10_000_00, 10_000_00, 80).state).toBe("warning");
    expect(evaluateBudget(10_000_00, 10_000_01, 80)).toMatchObject({ state: "exceeded", remainingPaise: -1 });
  });

  it("treats a net refund month as zero used, not negative", () => {
    expect(evaluateBudget(1_000_00, -500_00, 80)).toMatchObject({ percentUsed: 0, remainingPaise: 1_000_00, state: "ok" });
  });

  it("uses the latest budget that started on or before the month", () => {
    const rows = [{ periodStart: "2026-01-01", v: 1 }, { periodStart: "2026-08-01", v: 2 }, { periodStart: "2026-12-01", v: 3 }];
    expect(budgetInForce(rows, "2026-10")?.v).toBe(2);
    expect(budgetInForce(rows, "2026-12")?.v).toBe(3);
    expect(budgetInForce(rows, "2025-12")).toBeNull();
  });
});
