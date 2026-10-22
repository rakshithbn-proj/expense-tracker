import Link from "next/link";
import { formatDayShort, formatSignedInr, STATUS_LABELS, TYPE_LABELS } from "@/lib/format";
import type { TransactionDto } from "@/server/finance/transactions-service";
import { Badge } from "./ui";

export function TransactionRow({
  t,
  categoryName,
  accountName,
  showDate = true,
}: {
  t: TransactionDto;
  categoryName: Map<string, string>;
  accountName: Map<string, string>;
  showDate?: boolean;
}) {
  const title = t.merchantName ?? t.originalDescription ?? TYPE_LABELS[t.transactionType];
  const category = t.categoryId ? categoryName.get(t.categoryId) : null;
  // Refunds show the category they reduce; a linked reversal just cancels its original.
  const showType = !["purchase", "fee", "refund"].includes(t.transactionType);
  return (
    <li>
      <Link
        href={`/transactions/${t.id}`}
        className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-background"
        data-testid="transaction-row"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {showDate && <span>{formatDayShort(t.transactionDate)}</span>}
            <span>{showType ? TYPE_LABELS[t.transactionType] : (category ?? "Uncategorized")}</span>
            {t.financialAccountId && <span className="truncate">{accountName.get(t.financialAccountId)}</span>}
            {t.transactionStatus !== "posted" && (
              <Badge tone={t.transactionStatus === "pending" ? "info" : "neutral"}>{STATUS_LABELS[t.transactionStatus]}</Badge>
            )}
            {t.needsReview && <Badge tone="attention">Needs review</Badge>}
            {t.isSample && <Badge>Sample</Badge>}
          </div>
        </div>
        <div
          className={`shrink-0 text-sm font-semibold tabular-nums ${t.transactionStatus === "failed" || t.transactionStatus === "reversed" ? "text-muted line-through" : t.direction === "credit" ? "text-success" : ""}`}
        >
          {formatSignedInr(t.amountPaise, t.direction)}
        </div>
      </Link>
    </li>
  );
}
