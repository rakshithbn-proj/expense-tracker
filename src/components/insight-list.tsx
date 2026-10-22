import { formatDate, formatInr, formatMonthShort } from "@/lib/format";
import type { InsightResult } from "@/server/finance/analytics";
import { EmptyState } from "./ui";

// Each insight states the figures and the comparison period it is based on.
export function InsightList({ result, month, categoryName }: { result: InsightResult; month: string; categoryName: Map<string, string> }) {
  if (result.status === "insufficient_history") {
    return (
      <EmptyState>
        Not enough history for insights yet. They need transactions going back to at least {formatDate(result.requiredFrom)}, so this month can be
        compared with the same days of the previous three months.
      </EmptyState>
    );
  }
  if (result.insights.length === 0) {
    return (
      <EmptyState>
        Nothing unusual: no category is at least 25% and ₹500 away from its average for days 1–{result.throughDay} of{" "}
        {result.comparisonMonths.map(formatMonthShort).join(", ")}.
      </EmptyState>
    );
  }
  const months = result.comparisonMonths.map(formatMonthShort).join(", ");
  return (
    <ul className="flex flex-col gap-3">
      {result.insights.map((i) => {
        const name = i.scope === "overall" ? "Total spending" : i.categoryId ? (categoryName.get(i.categoryId) ?? "A category") : "Uncategorized";
        const higher = i.currentPaise > i.averagePaise;
        const change = i.changePercent === null ? "new this period" : `${Math.abs(i.changePercent)}% ${higher ? "higher" : "lower"}`;
        return (
          <li key={`${i.scope}-${i.categoryId}`} className="text-sm">
            <span aria-hidden className="mr-1.5">{higher ? "▲" : "▼"}</span>
            <strong>{name}</strong> is {change}: {formatInr(i.currentPaise)} in days 1–{i.throughDay} of {formatMonthShort(month)}, against an average of{" "}
            {formatInr(i.averagePaise)} for the same days of {months}.
          </li>
        );
      })}
    </ul>
  );
}
