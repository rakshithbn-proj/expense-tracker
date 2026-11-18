"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui";
import { projectCap, type AllowanceToday } from "@/lib/daily-allowance";
import { formatInrWhole } from "@/lib/format";
import { MoneyParseError, parseAmountToPaise } from "@/lib/money";

export type AllowanceView = { label: string; startMonth: string; today: AllowanceToday };

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

// Today's allowance for the chosen why's total budget, plus a "what if I spend this?" calculator.
export function DailyAllowanceCard({ allowance }: { allowance: AllowanceView }) {
  return (
    <div className="flex flex-col gap-4">
      <AllowanceRow a={allowance} />
      <Calculator allowance={allowance} />
    </div>
  );
}

function AllowanceRow({ a }: { a: AllowanceView }) {
  const t = a.today;
  const cap = projectCap(t);
  const over = t.leftTodayPaise < 0;
  return (
    <div data-testid="daily-allowance-row">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{a.label}</span>
        <span className="shrink-0 text-2xl font-semibold tabular-nums" data-testid="daily-allowance-left">
          {formatInrWhole(Math.max(0, t.leftTodayPaise))} <span className="text-sm font-normal text-muted">left today</span>
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">
        Today&apos;s allowance {formatInrWhole(t.availableTodayPaise)}
        {t.carriedToTodayPaise > 0 && ` (${formatInrWhole(t.creditTodayPaise)} + ${formatInrWhole(t.carriedToTodayPaise)} carried over)`} · spent{" "}
        {formatInrWhole(t.spentTodayPaise)}
      </div>
      {over && (
        <div className="mt-1 text-xs">
          {formatInrWhole(-t.leftTodayPaise)} over today&apos;s allowance. Today closes at zero and the rest is spread over the coming days.
        </div>
      )}
      <div className="mt-1 text-xs">
        {cap.scope === "month"
          ? `From tomorrow: ${formatInrWhole(cap.capPaise)} a day for the last ${cap.days} day${cap.days === 1 ? "" : "s"}`
          : `Last day of the month. Next month: ${formatInrWhole(cap.capPaise)} a day`}
        {!over && t.leftTodayPaise > 0 && cap.scope === "month" && `, plus whatever is left today`}.
      </div>
      {cap.takenFromNextMonthPaise > 0 && (
        <div className="mt-1 text-xs">{formatInrWhole(cap.takenFromNextMonthPaise)} over this month&apos;s budget will be taken from next month.</div>
      )}
      {t.carryInPaise !== 0 && (
        <div className="mt-1 text-xs text-muted">
          {t.carryInPaise > 0
            ? `Includes ${formatInrWhole(t.carryInPaise)} left over from earlier months.`
            : `${formatInrWhole(-t.carryInPaise)} overspent in earlier months is being taken from this month.`}
        </div>
      )}
    </div>
  );
}

function Calculator({ allowance: chosen }: { allowance: AllowanceView }) {
  const [amount, setAmount] = useState("");

  let paise: number | null = null;
  let error: string | null = null;
  if (amount.trim() !== "") {
    try {
      paise = parseAmountToPaise(amount);
    } catch (e) {
      if (!(e instanceof MoneyParseError)) throw e;
      error = "Enter an amount like 2500 or 2,500.50.";
    }
  }

  const before = projectCap(chosen.today);
  const after = paise !== null ? projectCap(chosen.today, paise) : null;
  const reduction = after ? before.capPaise - after.capPaise : 0;
  const capWord = before.scope === "month" ? "daily expense cap" : "daily expense cap next month";

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 text-sm font-medium">Calculator: what if I spend this today?</div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Expense amount in rupees"
          inputMode="decimal"
          placeholder="Amount, e.g. 3000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} min-w-0 flex-1`}
          data-testid="allowance-calculator-amount"
        />
      </div>
      <div className="mt-2 text-sm" aria-live="polite" data-testid="allowance-calculator-result">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : after ? (
          <>
            <p>
              This expense shall reduce your daily expenditure by <strong>{formatInrWhole(reduction)}</strong> and the {capWord} will be{" "}
              <strong>{formatInrWhole(after.capPaise)}</strong>
              {after.scope === "month" ? ` for the last ${after.days} day${after.days === 1 ? "" : "s"}` : ""}.
            </p>
            {reduction === 0 && after.leftTodayPaise >= 0 && (
              <p className="mt-1 text-xs text-muted">
                It fits in today&apos;s allowance: {formatInrWhole(after.leftTodayPaise)} would still be left today.
              </p>
            )}
            {after.takenFromNextMonthPaise > before.takenFromNextMonthPaise && (
              <p className="mt-1 text-xs">
                {formatInrWhole(after.takenFromNextMonthPaise)} would be over this month&apos;s budget and taken from next month.
              </p>
            )}
          </>
        ) : (
          <span className="text-muted">
            Now: {formatInrWhole(before.capPaise)} a day {before.scope === "month" ? "from tomorrow" : "next month"}.
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">Counting from {monthName(chosen.startMonth)}.</p>
    </div>
  );
}
