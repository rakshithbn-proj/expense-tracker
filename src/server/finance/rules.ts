import type { RuleMatchType } from "@/lib/finance-types";

export type RuleLike = {
  id: string;
  matchType: RuleMatchType;
  matchValue: string; // already normalized
  categoryId: string;
  priority: number;
  isActive: boolean;
  createdAt: Date;
};

export type MatchInput = { merchantNormalized: string | null; originalDescription: string | null };

// Highest priority wins; ties go to the oldest rule so results never depend on query order.
export function matchCategoryRule<R extends RuleLike>(rules: R[], input: MatchInput): R | null {
  const description = input.originalDescription?.toUpperCase().replace(/\s+/g, " ") ?? null;
  const ordered = rules
    .filter((r) => r.isActive && r.matchValue.length > 0)
    .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  for (const rule of ordered) {
    switch (rule.matchType) {
      case "merchant_exact":
        if (input.merchantNormalized === rule.matchValue) return rule;
        break;
      case "merchant_contains":
        if (input.merchantNormalized?.includes(rule.matchValue)) return rule;
        break;
      case "description_contains":
        if (description?.includes(rule.matchValue)) return rule;
        break;
    }
  }
  return null;
}
