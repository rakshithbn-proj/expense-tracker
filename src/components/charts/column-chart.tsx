"use client";

import { useState } from "react";
import { useContainerWidth } from "./use-width";
import { formatInr, formatInrCompact } from "@/lib/format";

export type Column = { label: string; paise: number; detail?: string };

const H = 180;
const PAD = { top: 18, right: 8, bottom: 24, left: 52 };

// Single-series columns: <= 24px wide, rounded at the cap, square at the baseline. Each column
// is its own hover/focus target. Only the largest value is labelled; the table has the rest.
export function ColumnChart({ columns, caption }: { columns: Column[]; caption: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useContainerWidth<HTMLDivElement>(640);
  const max = Math.max(...columns.map((c) => c.paise), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(columns.length, 1);
  const barW = Math.min(24, band * 0.6);
  // Thin out axis labels when bands are narrower than a label; tooltip and table keep every value.
  const labelStep = Math.max(1, Math.ceil(44 / band));
  const peak = columns.reduce((best, c, i) => (c.paise > columns[best].paise ? i : best), 0);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH;

  return (
    <figure>
      <div className="relative" ref={wrapRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={caption}>
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth={1} />
          <text x={PAD.left - 8} y={PAD.top} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)">
            {formatInrCompact(max)}
          </text>
          {columns.map((c, i) => {
            const cx = PAD.left + band * i + band / 2;
            const top = y(c.paise);
            const h = PAD.top + innerH - top;
            const r = Math.min(4, h);
            return (
              <g
                key={c.label}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${c.label}: ${formatInr(c.paise)}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              >
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="transparent" />
                {h > 0 && (
                  <path
                    d={`M${cx - barW / 2},${top + h} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${top + h} Z`}
                    fill="var(--series-1)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i === peak && c.paise > 0 && (
                  <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fill="var(--foreground)" className="tabular-nums">
                    {formatInrCompact(c.paise)}
                  </text>
                )}
                {i % labelStep === 0 && (
                  <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm"
            style={{
              left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`,
              transform: hover > columns.length / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <strong className="tabular-nums">{formatInr(columns[hover].paise)}</strong>
            <span className="ml-2 text-muted">{columns[hover].label}</span>
            {columns[hover].detail && <div className="text-muted">{columns[hover].detail}</div>}
          </div>
        )}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <tbody>
            {columns.map((c) => (
              <tr key={c.label} className="border-t border-border">
                <td className="py-1 pr-3">{c.label}</td>
                <td className="py-1 pr-3">{formatInr(c.paise)}</td>
                {c.detail && <td className="py-1 text-muted">{c.detail}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
