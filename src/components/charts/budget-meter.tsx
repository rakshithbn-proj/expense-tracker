import { formatInr } from "@/lib/format";

type State = "ok" | "warning" | "exceeded";

const STATE = {
  ok: { icon: "✓", label: "On track", color: "var(--status-good)" },
  warning: { icon: "!", label: "Near limit", color: "var(--status-warning)" },
  exceeded: { icon: "✕", label: "Over budget", color: "var(--status-critical)" },
} as const;

// The fill carries severity; the state is always spelled out with an icon and label.
export function BudgetMeter({
  label,
  spentPaise,
  limitPaise,
  percentUsed,
  state,
}: {
  label: string;
  spentPaise: number;
  limitPaise: number;
  percentUsed: number;
  state: State;
}) {
  const s = STATE[state];
  const remaining = limitPaise - Math.max(0, spentPaise);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums">
          {formatInr(Math.max(0, spentPaise))} <span className="text-muted">of {formatInr(limitPaise)}</span>
        </span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-track"
        role="meter"
        aria-label={`${label} budget used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percentUsed, 100)}
        aria-valuetext={`${percentUsed}% used, ${s.label}`}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(percentUsed, 100)}%`, background: s.color }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>
          <span
            aria-hidden
            className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: s.color, color: state === "warning" ? "#0b0b0b" : "#ffffff" }}
          >
            {s.icon}
          </span>
          {s.label} · {percentUsed}% used
        </span>
        <span className="tabular-nums">{remaining >= 0 ? `${formatInr(remaining)} left` : `${formatInr(-remaining)} over`}</span>
      </div>
    </div>
  );
}
