# ADR-0006: Accounting model

Status: Accepted (Milestone 2)

## Decisions

1. **One implementation of the rules.** `src/server/finance/accounting.ts` (`spendingEffect`,
   `summarize`) is the only code that decides what counts as spending. Services load the
   relevant rows and call it. With one user's volume (thousands of rows a year), a month or a
   year fits easily in memory, which keeps the rules in plain, unit-tested TypeScript instead of
   duplicated SQL. If a report ever needs SQL aggregation, it must be tested against `summarize`.

2. **The transaction type is the source of truth.** The spec's flags `is_internal_transfer`,
   `is_credit_card_settlement`, `is_refund` and `is_reversal` are derived from
   `transaction_type`, so they can't contradict each other. A database check enforces which
   directions each type may have (for example, a refund is always a credit).

3. **Type meanings.**
   - `purchase`: any spending, **including paying another person or business** by UPI, IMPS or NEFT.
   - `internal_transfer`: money between two of the user's **own** accounts. Never assumed: it's
     set by a source that says so, or by the user pairing both sides.
   - `card_settlement`: paying a credit card bill. The bank debit and the card credit are paired.
   - `fee`: bank charges, card fees and interest. These count as spending.
   - `refund`, `reversal`: credits that undo spending.
   - `income`, `investment`, `cash_withdrawal`, `other`: not consumption spending.

4. **Net spending** = purchases and fees (pending and posted) − refunds − unlinked reversals.
   Failed and reversed transactions, voided entries and non-INR amounts are excluded.
   Foreign-currency entries are counted and reported, not silently dropped.

5. **Refunds** reduce spending in the **original purchase's category**, in the month the refund
   happens (cash basis). Linking happens automatically only when exactly one candidate is
   clearly best: same merchant and/or account, within 180 days, with enough unrefunded amount.
   Otherwise the refund stays unlinked and is flagged for review. A parent is never invented.
   Total refunds can't exceed the original.

6. **Reversals** must match the full amount. Linking one sets the original to `reversed`, which
   removes it from spending, and the reversal itself then counts zero. The original row is
   kept. An unlinked reversal subtracts in its own category, so the month still nets correctly,
   and is flagged for review.

7. **Transfers and settlements.** Two sides are paired only if they have the same amount,
   opposite directions, are on different accounts **the user owns**, and are within 3 days. A
   transaction is paired automatically only when a source already identified it as a
   transfer/settlement and exactly one counterpart exists. An unknown debit is never turned into
   a transfer automatically.

8. **Status changes** from repeated or out-of-order alerts follow `nextStatus`: a late failure
   can't undo a posted payment, a stale "pending" is ignored, and `reversed` is final. Conflicts
   are reported for review.

9. **History is never erased.** Corrections update the row and write an audit event with
   before/after values. "Deleting" a transaction voids it (`voided_at`), so it disappears from
   lists and totals but stays in the database. Linked rows must be unlinked first. Only
   `--remove` on the development sample seed hard-deletes, and only rows marked `is_sample`.

10. **Budgets** are monthly. A budget row applies from its start month until a later row for the
    same category replaces it, so limits don't need re-entering every month. Usage uses the same
    net spending as everything else. A net-refund month counts as 0% used, never negative.

11. **Future split transactions.** A later `transaction_allocations` table (transaction id,
    category id, amount) can override `transactions.category_id` without duplicating the
    financial event. Nothing in this model assumes one category forever.

12. **Categorization** is deterministic: an explicit user choice, then the highest-priority
    active rule (oldest wins ties), then a type default (investments only). Otherwise the
    transaction is uncategorized and flagged for review. A rule is only created from a
    correction when the user explicitly asks (`createRule: true`).
