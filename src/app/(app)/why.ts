import { z } from "zod";

// Overview and Budgets show one "why" at a time. They default to this one when the user has
// used it; "all" means every payment.
const DEFAULT_REASON = "shared rental expense";
export const ALL_REASONS = "all";

// Picks the "why" from the `why` query value: `value` is what the picker shows, `reason` is
// the filter (null = all spending), and `options` always contains the chosen reason.
export function chooseWhy(requestedValue: unknown, used: string[]) {
  const requested = z.string().max(500).optional().catch(undefined).parse(requestedValue);
  const value = requested ?? used.find((r) => r.toLowerCase() === DEFAULT_REASON) ?? ALL_REASONS;
  const reason = value === ALL_REASONS ? null : value;
  const options = reason && !used.includes(reason) ? [...used, reason] : used;
  return { requested, value, reason, options };
}
