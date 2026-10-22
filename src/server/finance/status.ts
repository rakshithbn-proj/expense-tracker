import type { TransactionStatus } from "@/lib/finance-types";

export type StatusDecision = { status: TransactionStatus; changed: boolean; conflict: string | null };

// Decides the status when a new alert arrives for a transaction we already have.
// Repeated or out-of-order success/failure alerts must not flip a settled outcome.
// "reversed" is only ever set by linking a reversal, never by an incoming alert.
export function nextStatus(current: TransactionStatus, incoming: Exclude<TransactionStatus, "reversed">): StatusDecision {
  const keep = (conflict: string | null = null): StatusDecision => ({ status: current, changed: false, conflict });
  const move = (conflict: string | null = null): StatusDecision => ({ status: incoming, changed: true, conflict });

  if (current === incoming) return keep();

  switch (current) {
    case "pending":
      return move();
    case "posted":
      // A late "pending" is stale. A "failed" after "posted" contradicts evidence that money moved.
      return incoming === "failed" ? keep("failure alert received after success") : keep();
    case "failed":
      // Money moving later is stronger evidence than an earlier failure, but needs a look.
      return incoming === "posted" ? move("success alert received after failure") : keep();
    case "reversed":
      return keep(`${incoming} alert received for a reversed transaction`);
  }
}
