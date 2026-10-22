export type BudgetState = "ok" | "warning" | "exceeded";

export type BudgetEvaluation = {
  limitPaise: number;
  spentPaise: number;
  remainingPaise: number;
  percentUsed: number; // whole percent, never negative
  state: BudgetState;
};

// `spentPaise` is net spending from summarize(); refunds can make it negative.
export function evaluateBudget(limitPaise: number, spentPaise: number, warnAtPercent: number): BudgetEvaluation {
  if (limitPaise <= 0) throw new Error("Budget limit must be positive");
  const used = Math.max(0, spentPaise);
  const percentUsed = Math.floor((used * 100) / limitPaise);
  const state: BudgetState = used > limitPaise ? "exceeded" : percentUsed >= warnAtPercent ? "warning" : "ok";
  return { limitPaise, spentPaise, remainingPaise: limitPaise - used, percentUsed, state };
}

// Picks the budget row in force for a month: the latest period_start on or before it.
export function budgetInForce<B extends { periodStart: string }>(rows: B[], month: string): B | null {
  const monthStart = `${month}-01`;
  let best: B | null = null;
  for (const r of rows) {
    if (r.periodStart <= monthStart && (!best || r.periodStart > best.periodStart)) best = r;
  }
  return best;
}
