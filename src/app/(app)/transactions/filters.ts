import type { ListFilter } from "@/server/finance/transactions-service";

// URL parameters used by the filter form (short, human-readable) mapped to the service filter.
export type FilterParams = Partial<
  Record<"q" | "from" | "to" | "category" | "account" | "method" | "app" | "min" | "max" | "status" | "type" | "capture" | "review" | "sort" | "page", string>
>;

const rupeesToPaise = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

export function toServiceFilter(p: FilterParams): ListFilter {
  const [sort, order] = (p.sort ?? "date-desc").split("-") as ["date" | "amount", "asc" | "desc"];
  return {
    q: p.q || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
    categoryIds: p.category && p.category !== "uncategorized" ? [p.category] : undefined,
    uncategorized: p.category === "uncategorized" ? true : undefined,
    accountIds: p.account ? [p.account] : undefined,
    paymentMethods: p.method ? [p.method as never] : undefined,
    paymentApps: p.app ? [p.app] : undefined,
    minAmountPaise: rupeesToPaise(p.min),
    maxAmountPaise: rupeesToPaise(p.max),
    statuses: p.status ? [p.status as never] : undefined,
    types: p.type ? [p.type as never] : undefined,
    captureMethods: p.capture ? [p.capture as never] : undefined,
    needsReview: p.review === "1" ? true : undefined,
    sort: sort === "amount" ? "amount" : "date",
    order: order === "asc" ? "asc" : "desc",
    page: Number(p.page) || 1,
    pageSize: 50,
  };
}

export const FILTER_KEYS = ["q", "from", "to", "category", "account", "method", "app", "min", "max", "status", "type", "capture", "review"] as const;

export function activeFilterCount(p: FilterParams): number {
  return FILTER_KEYS.filter((k) => p[k]).length;
}

export function withParams(p: FilterParams, changes: FilterParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...changes })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/transactions?${s}` : "/transactions";
}
