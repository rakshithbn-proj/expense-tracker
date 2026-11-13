"use client";

import Link from "next/link";
import { useState } from "react";
import { formatInr, formatInrWhole } from "@/lib/format";

export type PieItem = { key: string; label: string; paise: number; href?: string; detail?: string };

// Categorical slots in fixed order (never cycled); anything past them folds into "Other".
const COLORS = ["series-1", "series-compare", "series-3", "series-4", "series-5", "series-6", "series-7"];
const OTHER = "series-other";

const SIZE = 180;
const R = 86;
const INNER = 56;
const C = SIZE / 2;

const point = (r: number, turn: number) => {
  const a = turn * 2 * Math.PI - Math.PI / 2; // start at 12 o'clock, clockwise
  return `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
};

function arc(from: number, to: number) {
  const large = to - from > 0.5 ? 1 : 0;
  return `M${point(R, from)} A${R},${R} 0 ${large} 1 ${point(R, to)} L${point(INNER, to)} A${INNER},${INNER} 0 ${large} 0 ${point(INNER, from)} Z`;
}

// Donut of each item's share of the positive total. Slices are separated by a 2px surface gap;
// the legend beside it carries every label, amount and share (so colour is never the only cue)
// and doubles as the table view. Items at or below zero (refunds outweighing spending) can't be
// a slice; they are listed under the legend instead.
export function PieChart({ items, caption, emptyText = "Nothing to show yet." }: { items: PieItem[]; caption: string; emptyText?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const positive = items.filter((i) => i.paise > 0).sort((a, b) => b.paise - a.paise);
  const negative = items.filter((i) => i.paise <= 0);
  if (positive.length === 0 && negative.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;

  const shown = positive.length > COLORS.length ? positive.slice(0, COLORS.length - 1) : positive;
  const folded = positive.slice(shown.length);
  const slices = [
    ...shown.map((i, n) => ({ ...i, color: COLORS[n] })),
    ...(folded.length
      ? [{ key: "__other", label: `Other (${folded.length})`, paise: folded.reduce((s, i) => s + i.paise, 0), color: OTHER, href: undefined, detail: undefined }]
      : []),
  ];
  const total = slices.reduce((s, i) => s + i.paise, 0);
  const share = (paise: number) => (total > 0 ? Math.round((paise / total) * 1000) / 10 : 0);

  let cursor = 0;
  const geometry = slices.map((s) => {
    const from = cursor;
    cursor += s.paise / total;
    return { ...s, from, to: cursor };
  });
  const active = geometry.find((g) => g.key === hover) ?? null;
  const dim = (key: string) => (hover === null || hover === key ? 1 : 0.45);
  const hoverProps = (key: string) => ({
    onPointerEnter: () => setHover(key),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(key),
    onBlur: () => setHover(null),
  });

  return (
    <figure className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      {total > 0 && (
        <div className="relative aspect-square w-full max-w-[300px] shrink-0 sm:w-[300px]">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={caption} className="block h-full w-full">
            {geometry.map((g) => (
              <g key={g.key} tabIndex={0} role="graphics-symbol" aria-label={`${g.label}: ${formatInr(g.paise)}, ${share(g.paise)}%`} className="outline-none" {...hoverProps(g.key)}>
                {g.to - g.from >= 0.9999 ? (
                  <circle cx={C} cy={C} r={(R + INNER) / 2} fill="none" stroke={`var(--${g.color})`} strokeWidth={R - INNER} opacity={dim(g.key)} />
                ) : (
                  <path d={arc(g.from, g.to)} fill={`var(--${g.color})`} stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={dim(g.key)} />
                )}
              </g>
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[22%] text-center" aria-hidden>
            <span className="max-w-full truncate text-sm text-muted">{active ? active.label : "Total"}</span>
            <span className="text-xl font-semibold tabular-nums">{formatInrWhole(active ? active.paise : total)}</span>
            {active && <span className="text-sm text-muted tabular-nums">{share(active.paise)}%</span>}
          </div>
        </div>
      )}
      <figcaption className="sr-only">{caption}</figcaption>

      <div className="flex w-full min-w-0 flex-col gap-1">
        <ul className="flex flex-col">
          {geometry.map((g) => {
            const label = (
              <span className="truncate" title={g.label}>
                {g.label}
              </span>
            );
            return (
              <li key={g.key} className="rounded-lg px-1 py-1 text-sm" style={{ opacity: dim(g.key) }} {...hoverProps(g.key)}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--${g.color})` }} aria-hidden />
                  {g.href ? (
                    <Link href={g.href} className="min-w-0 truncate hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                  <span className="ml-auto shrink-0 font-medium tabular-nums">{formatInr(g.paise)}</span>
                  <span className="w-12 shrink-0 text-right text-xs text-muted tabular-nums">{share(g.paise)}%</span>
                </div>
                {g.detail && <div className="pl-[18px] text-xs text-muted">{g.detail}</div>}
              </li>
            );
          })}
        </ul>
        {folded.length > 0 && (
          <details className="px-1 text-xs">
            <summary className="cursor-pointer text-muted">What&apos;s in Other</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {folded.map((i) => (
                <li key={i.key} className="flex justify-between gap-3">
                  {i.href ? (
                    <Link href={i.href} className="truncate hover:underline">
                      {i.label}
                    </Link>
                  ) : (
                    <span className="truncate">{i.label}</span>
                  )}
                  <span className="shrink-0 tabular-nums">{formatInr(i.paise)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {negative.length > 0 && (
          <div className="px-1 text-xs text-muted">
            <p>Refunds outweigh spending, so not in the chart:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {negative.map((i) => (
                <li key={i.key} className="flex justify-between gap-3">
                  {i.href ? (
                    <Link href={i.href} className="truncate hover:underline">
                      {i.label}
                    </Link>
                  ) : (
                    <span className="truncate">{i.label}</span>
                  )}
                  <span className="shrink-0 tabular-nums">{formatInr(i.paise)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </figure>
  );
}
