import type { ListFilter } from "@/server/finance/transactions-service";

// "why" value for transactions without a reason.
export const NO_REASON = "__none";

// URL parameters used by the filter form (short, human-readable) mapped to the service filter.
// "account" holds one or more account ids, comma-separated. "why" holds one or more reasons
// separated by line breaks, because a reason may itself contain a comma.
export type FilterParams = Partial<
  Record<"q" | "from" | "to" | "category" | "account" | "method" | "app" | "why" | "min" | "max" | "status" | "type" | "capture" | "review" | "sort" | "page", string>
>;

const rupeesToPaise = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

export function toServiceFilter(p: FilterParams): ListFilter {
  const [sort, order] = (p.sort ?? "date-desc").split("-") as ["date" | "amount", "asc" | "desc"];
  const whys = (p.why ?? "").split(WHY_SEPARATOR).filter((w) => w && w !== NO_REASON);
  return {
    q: p.q || undefined,
    from: p.from || undefined,
    to: p.to || undefined,
    categoryIds: p.category && p.category !== "uncategorized" ? [p.category] : undefined,
    uncategorized: p.category === "uncategorized" ? true : undefined,
    accountIds: p.account ? p.account.split(",").filter(Boolean) : undefined,
    paymentMethods: p.method ? [p.method as never] : undefined,
    paymentApps: p.app ? [p.app] : undefined,
    reasons: whys.length ? whys : undefined,
    noReason: p.why?.split(WHY_SEPARATOR).includes(NO_REASON) ? true : undefined,
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

export const FILTER_KEYS = ["q", "from", "to", "category", "account", "method", "app", "why", "min", "max", "status", "type", "capture", "review"] as const;

export const WHY_SEPARATOR = "\n";

// Next.js gives repeated parameters (one per ticked checkbox) as arrays; join them into one value.
export function toFilterParams(raw: Record<string, string | string[] | undefined>): FilterParams {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter(Boolean).join(k === "why" ? WHY_SEPARATOR : ",");
  }
  return out as FilterParams;
}

export function activeFilterCount(p: FilterParams): number {
  return FILTER_KEYS.filter((k) => p[k]).length;
}

export function withParams(p: FilterParams, changes: FilterParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...changes })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/transactions?${s}` : "/transactions";
}
