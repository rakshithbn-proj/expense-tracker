// Daily allowance: a monthly budget handed out a day at a time. Pure, so the Overview
// calculator can run it in the browser. All amounts are integer paise.
//
// Rules (agreed with the user, 2026-11-18):
// - Each day is credited (budget not yet handed out this month) / (days left, today included).
// - Money left unspent at the end of a day carries over in full to the next day.
// - Spending more than the day's allowance closes the day at zero; the overshoot comes out of
//   the rest of the month, so every later day's credit drops a little ("spread"). A big payment
//   like rent therefore shows up as a sudden lower daily credit from the next day.
// - Refunds count as negative spending on the day they happen, so they add back to that day.
// - Whatever is left at the end of a month (or overspent) is added to (or taken from) the next
//   month's budget and spread over its days. A deficit can eat into several months.

export type AllowanceMonth = {
  month: string; // YYYY-MM
  limitPaise: number; // the budget in force that month
  dailySpendPaise: number[]; // net spending per day, index 0 = day 1; one entry per day of the month
};

export type AllowanceToday = {
  date: string;
  daysInMonth: number;
  carryInPaise: number; // left over (+) or overspent (−) from earlier months, added to this month
  creditTodayPaise: number; // today's fresh credit
  carriedToTodayPaise: number; // unspent from earlier days this month
  availableTodayPaise: number; // credit + carried
  spentTodayPaise: number; // net, so far today
  leftTodayPaise: number; // available − spent; negative = over today's allowance
  poolAfterTodayPaise: number; // budget not yet handed out, after today's credit (before today's overspend)
  daysAfterToday: number; // days left in the month after today
  nextMonthLimitPaise: number;
  daysInNextMonth: number;
};

export function daysInMonthOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const creditFor = (pool: number, daysLeft: number) => (pool > 0 ? Math.floor(pool / daysLeft) : 0);

// Replays every finished day from the first month and returns where today stands.
// `months` must be consecutive and end with today's month; `nextMonthLimitPaise` is the budget
// in force next month (used when today is the last day).
export function allowanceToday(months: AllowanceMonth[], today: string, nextMonthLimitPaise: number): AllowanceToday {
  if (months.length === 0) throw new Error("No months to replay");
  const last = months[months.length - 1];
  if (!today.startsWith(last.month)) throw new Error("The last month must be today's month");
  const todayIndex = Number(today.slice(8, 10)) - 1;

  let carryIn = 0;
  for (const m of months) {
    const days = daysInMonthOf(m.month);
    let pool = m.limitPaise + carryIn;
    let carried = 0;
    const isCurrent = m === last;
    const lastDay = isCurrent ? todayIndex : days - 1;

    for (let d = 0; d <= lastDay; d++) {
      const credit = creditFor(pool, days - d);
      pool -= credit;
      const available = carried + credit;
      const spent = m.dailySpendPaise[d] ?? 0;
      const left = available - spent;

      if (isCurrent && d === todayIndex) {
        // Today isn't over: report it without settling it.
        return {
          date: today,
          daysInMonth: days,
          carryInPaise: carryIn,
          creditTodayPaise: credit,
          carriedToTodayPaise: carried,
          availableTodayPaise: available,
          spentTodayPaise: spent,
          leftTodayPaise: left,
          poolAfterTodayPaise: pool,
          daysAfterToday: days - d - 1,
          nextMonthLimitPaise,
          daysInNextMonth: daysInMonthOf(nextMonthOf(m.month)),
        };
      }
      if (left >= 0) carried = left;
      else {
        carried = 0;
        pool += left; // the overshoot is spread over the days still to come
      }
    }
    carryIn = pool + carried;
  }
  throw new Error("unreachable");
}

export type CapProjection = {
  scope: "month" | "next-month"; // whose days the cap is for
  capPaise: number; // daily credit for those days (before any carried-over money)
  days: number;
  leftTodayPaise: number; // today's balance after the extra spending (negative = over)
  takenFromNextMonthPaise: number; // overspend this month can't absorb, deducted from next month
};

// The daily cap from tomorrow if `extraPaise` more is spent today (0 = as things stand).
export function projectCap(t: AllowanceToday, extraPaise = 0): CapProjection {
  const left = t.leftTodayPaise - extraPaise;
  if (t.daysAfterToday > 0) {
    const pool = t.poolAfterTodayPaise + Math.min(0, left);
    return {
      scope: "month",
      capPaise: creditFor(pool, t.daysAfterToday),
      days: t.daysAfterToday,
      leftTodayPaise: left,
      takenFromNextMonthPaise: pool < 0 ? -pool : 0,
    };
  }
  // Last day of the month: whatever is left (or overspent) moves to next month.
  const carryOut = t.poolAfterTodayPaise + left;
  const pool = t.nextMonthLimitPaise + carryOut;
  return {
    scope: "next-month",
    capPaise: creditFor(pool, t.daysInNextMonth),
    days: t.daysInNextMonth,
    leftTodayPaise: left,
    takenFromNextMonthPaise: carryOut < 0 ? -carryOut : 0,
  };
}

function nextMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
