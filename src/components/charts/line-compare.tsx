"use client";

import { useId, useState } from "react";
import { useContainerWidth } from "./use-width";
import { formatInr, formatInrCompact } from "@/lib/format";

export type LineSeries = { name: string; values: number[]; color: "series-1" | "series-compare" };

const H = 220;
const PAD = { top: 12, right: 56, bottom: 24, left: 52 };

function niceMax(v: number) {
  if (v <= 0) return 100_00;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

// Cumulative spending by day of month, this month against last month. One y-axis, a crosshair
// that snaps to the nearest day, one tooltip listing every series, and a table view.
export function LineCompareChart({ series, xLabels, caption }: { series: LineSeries[]; xLabels: string[]; caption: string }) {
  const xLabel = (i: number) => xLabels[i] ?? String(i + 1);
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useContainerWidth<HTMLDivElement>(640);
  const tableId = useId();
  const length = Math.max(...series.map((s) => s.values.length), 1);
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (length <= 1 ? 0 : (i / (length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, max / 2, max];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(length - 1, Math.round(ratio * (length - 1)))));
  };

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: `var(--${s.color})` }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative" ref={wrapRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-muted)" className="tabular-nums">
                {formatInrCompact(t)}
              </text>
            </g>
          ))}
          {[0, Math.floor((length - 1) / 2), length - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
              {xLabel(i)}
            </text>
          ))}
          {series.map((s) => {
            const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
            const last = s.values.length - 1;
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={`var(--${s.color})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {last >= 0 && (
                  <>
                    <circle cx={x(last)} cy={y(s.values[last])} r={4} fill={`var(--${s.color})`} stroke="var(--surface)" strokeWidth={2} />
                    <text x={x(last) + 8} y={y(s.values[last])} dy="0.32em" fontSize={11} fill="var(--foreground)" className="tabular-nums">
                      {formatInrCompact(s.values[last])}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth={1} />
              {series.map((s) =>
                hover < s.values.length ? (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={`var(--${s.color})`} stroke="var(--surface)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            aria-label="Move along the chart to read values; the table below has every value"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 0) - 1));
              if (e.key === "ArrowRight") setHover((h) => Math.min(length - 1, (h ?? 0) + 1));
            }}
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
          >
            <div className="mb-1 text-muted">{xLabel(hover)}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: `var(--${s.color})` }} />
                <strong className="tabular-nums">{hover < s.values.length ? formatInr(s.values[hover]) : "—"}</strong>
                <span className="text-muted">{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted" aria-controls={tableId}>
          Show as table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table id={tableId} className="w-full text-left tabular-nums">
            <thead>
              <tr className="text-muted">
                <th className="py-1 pr-3 font-medium">Day</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-3 font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length }, (_, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-3">{xLabel(i)}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-3">
                      {i < s.values.length ? formatInr(s.values[i]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
