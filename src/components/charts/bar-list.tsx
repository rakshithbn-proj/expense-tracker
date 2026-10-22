import Link from "next/link";
import { formatInr } from "@/lib/format";

export type BarItem = { key: string; label: string; paise: number; href?: string; detail?: string };

// Single-series horizontal bars: thin, rounded at the data end, value at the tip.
// Negative values (net refunds) are listed with their value but draw no bar.
export function BarList({ items, emptyText = "Nothing to show yet." }: { items: BarItem[]; emptyText?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.paise), 1);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const width = item.paise > 0 ? Math.max(1.5, (item.paise / max) * 100) : 0;
        const label = (
          <span className="truncate" title={item.label}>
            {item.label}
          </span>
        );
        return (
          <li key={item.key} className="group">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              {item.href ? (
                <Link href={item.href} className="min-w-0 truncate hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 font-medium tabular-nums">{formatInr(item.paise)}</span>
            </div>
            <div className="h-2.5 w-full" aria-hidden>
              <div
                className="h-full rounded-r-[4px] bg-series-1 transition-opacity group-hover:opacity-80"
                style={{ width: `${width}%` }}
              />
            </div>
            {item.detail && <div className="mt-0.5 text-xs text-muted">{item.detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}
