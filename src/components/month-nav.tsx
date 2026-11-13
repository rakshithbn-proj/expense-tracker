import Link from "next/link";
import { addMonths } from "@/lib/dates";
import { formatMonth } from "@/lib/format";

// `keep` holds other query parameters to carry across months (e.g. the overview's "why").
export function MonthNav({ month, currentMonth, basePath, keep = {} }: { month: string; currentMonth: string; basePath: string; keep?: Record<string, string> }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const link = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm";
  const href = (m: string) => `${basePath}?${new URLSearchParams({ month: m, ...keep })}`;
  return (
    <nav aria-label="Month" className="flex items-center gap-2">
      <Link href={href(prev)} className={link} aria-label={`Previous month, ${formatMonth(prev)}`}>
        ‹
      </Link>
      <span className="min-w-36 text-center text-sm font-medium">{formatMonth(month)}</span>
      {next <= currentMonth ? (
        <Link href={href(next)} className={link} aria-label={`Next month, ${formatMonth(next)}`}>
          ›
        </Link>
      ) : (
        <span className={`${link} opacity-40`} aria-hidden>
          ›
        </span>
      )}
    </nav>
  );
}
