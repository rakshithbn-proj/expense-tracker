import { describe, expect, it } from "vitest";
import {
  channelOf,
  cumulativeByDay,
  daysInMonth,
  detectRecurring,
  groupSpending,
  suggestBudgets,
  unusualSpending,
  weekdayPattern,
  type AnalyzedTx,
} from "@/server/finance/analytics";

let n = 0;
const t = (o: Partial<AnalyzedTx> & { date: string; effectPaise: number }): AnalyzedTx => {
  const amountPaise = o.amountPaise ?? Math.abs(o.effectPaise);
  return {
    id: `t${++n}`,
    merchant: "Shop",
    merchantKey: "SHOP",
    accountId: "acc",
    paymentMethod: "upi",
    paymentApp: null,
    type: "purchase",
    direction: "debit",
    status: "posted",
    currency: "INR",
    effectCategoryId: "food",
    captureMethod: "manual",
    isSample: false,
    ...o,
    amountPaise,
    ledger: { id: "x", amountPaise, currency: "INR", direction: "debit", type: "purchase", status: "posted", categoryId: null, parentTransactionId: null, voided: false },
  };
};

describe("breakdowns", () => {
  it("groups net spending, skips non-spending and sorts largest first", () => {
    const groups = groupSpending(
      [
        t({ date: "2026-10-01", effectPaise: 500_00, effectCategoryId: "food" }),
        t({ date: "2026-10-02", effectPaise: 2000_00, effectCategoryId: "rent" }),
        t({ date: "2026-10-03", effectPaise: -100_00, effectCategoryId: "food" }),
        t({ date: "2026-10-04", effectPaise: 0, effectCategoryId: null }),
      ],
      (x) => x.effectCategoryId,
    );
    expect(groups).toEqual([
      { key: "rent", paise: 2000_00, count: 1 },
      { key: "food", paise: 400_00, count: 2 },
    ]);
  });

  it("builds a running total per day of month", () => {
    const series = cumulativeByDay(
      [t({ date: "2026-02-01", effectPaise: 100 }), t({ date: "2026-02-03", effectPaise: 50 }), t({ date: "2026-03-01", effectPaise: 999 })],
      "2026-02",
    );
    expect(series).toHaveLength(28);
    expect(series.slice(0, 4)).toEqual([100, 100, 150, 150]);
    expect(series[27]).toBe(150);
  });

  it("knows month lengths", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("averages weekdays over the days actually in the range", () => {
    // 2026-10-05 is a Monday; the range has two Mondays.
    const w = weekdayPattern([t({ date: "2026-10-05", effectPaise: 300_00 }), t({ date: "2026-10-12", effectPaise: 100_00 })], "2026-10-05", "2026-10-18");
    expect(w[0]).toMatchObject({ label: "Mon", totalPaise: 400_00, averagePaise: 200_00, days: 2 });
    expect(w[6]).toMatchObject({ label: "Sun", days: 2, totalPaise: 0 });
  });

  it("classifies UPI vs cards", () => {
    expect(channelOf("upi")).toBe("UPI");
    expect(channelOf("debit_card")).toBe("Cards");
    expect(channelOf("net_banking")).toBe("Other");
  });
});

describe("detectRecurring", () => {
  it("finds a monthly subscription with a stable amount", () => {
    const items = ["2026-06-08", "2026-07-08", "2026-08-08", "2026-09-08"].map((date) =>
      t({ date, effectPaise: 649_00, merchant: "Netflix", merchantKey: "NETFLIX", effectCategoryId: "subs" }),
    );
    expect(detectRecurring(items, 6)).toEqual([
      { merchantKey: "NETFLIX", merchant: "Netflix", typicalPaise: 649_00, monthsSeen: 4, monthsChecked: 6, lastDate: "2026-09-08", categoryId: "subs" },
    ]);
  });

  it("ignores frequent merchants, varying amounts and fewer than 3 months", () => {
    const frequent = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-08-01", "2026-08-08", "2026-09-01", "2026-09-08"].map((date) =>
      t({ date, effectPaise: 400_00, merchantKey: "SWIGGY" }),
    );
    const varying = [["2026-07-03", 100_00], ["2026-08-03", 900_00], ["2026-09-03", 2500_00]].map(([date, p]) =>
      t({ date: date as string, effectPaise: p as number, merchantKey: "AMAZON" }),
    );
    const short = ["2026-08-05", "2026-09-05"].map((date) => t({ date, effectPaise: 199_00, merchantKey: "SPOTIFY" }));
    expect(detectRecurring([...frequent, ...varying, ...short], 6)).toEqual([]);
  });
});

describe("unusualSpending", () => {
  const history = (cat: string, perMonth: number, months: string[], day = 5) =>
    months.map((m) => t({ date: `${m}-${String(day).padStart(2, "0")}`, effectPaise: perMonth, effectCategoryId: cat }));

  it("refuses to invent insights without three months of history", () => {
    const r = unusualSpending([t({ date: "2026-10-02", effectPaise: 9000_00 })], "2026-10", 22, "2026-08-15");
    expect(r).toEqual({ status: "insufficient_history", requiredFrom: "2026-07-01" });
    expect(unusualSpending([], "2026-10", 22, null).status).toBe("insufficient_history");
  });

  it("reports a 25%+ and ₹500+ rise against the same days of the previous three months", () => {
    const items = [...history("food", 4000_00, ["2026-07", "2026-08", "2026-09"]), t({ date: "2026-10-04", effectPaise: 5000_00, effectCategoryId: "food" })];
    const r = unusualSpending(items, "2026-10", 22, "2026-07-01");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const food = r.insights.find((i) => i.scope === "category" && i.categoryId === "food");
    expect(food).toMatchObject({ currentPaise: 5000_00, averagePaise: 4000_00, changePercent: 25, throughDay: 22 });
    expect(r.comparisonMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(r.insights[0].scope).toBe("overall");
  });

  it("only compares the same days, so late-month spending earlier doesn't distort a part month", () => {
    const items = [...history("food", 4000_00, ["2026-07", "2026-08", "2026-09"], 28), t({ date: "2026-10-04", effectPaise: 100_00, effectCategoryId: "food" })];
    const r = unusualSpending(items, "2026-10", 10, "2026-07-01");
    expect(r.status === "ok" && r.insights).toEqual([]);
  });

  it("stays quiet for small or proportionally minor changes", () => {
    const small = [...history("food", 1000_00, ["2026-07", "2026-08", "2026-09"]), t({ date: "2026-10-04", effectPaise: 1400_00, effectCategoryId: "food" })];
    const minor = [...history("rent", 25000_00, ["2026-07", "2026-08", "2026-09"]), t({ date: "2026-10-04", effectPaise: 27000_00, effectCategoryId: "rent" })];
    for (const items of [small, minor]) {
      const r = unusualSpending(items, "2026-10", 22, "2026-07-01");
      expect(r.status === "ok" && r.insights).toEqual([]);
    }
  });

  it("keeps uncategorized separate from the overall total", () => {
    const items = [...history("food", 0, ["2026-07", "2026-08", "2026-09"]), t({ date: "2026-10-04", effectPaise: 3000_00, effectCategoryId: null })];
    const r = unusualSpending(items, "2026-10", 22, "2026-07-01");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.insights.map((i) => [i.scope, i.categoryId])).toEqual([
      ["overall", null],
      ["category", null],
    ]);
  });
});

describe("suggestBudgets", () => {
  it("suggests the 3-month average rounded up to ₹500, only with enough history", () => {
    const items = [
      t({ date: "2026-07-03", effectPaise: 3000_00, effectCategoryId: "food" }),
      t({ date: "2026-08-03", effectPaise: 4000_00, effectCategoryId: "food" }),
      t({ date: "2026-09-03", effectPaise: 5100_00, effectCategoryId: "food" }),
    ];
    const s = suggestBudgets(items, "2026-10", "2026-07-01");
    expect(s).toContainEqual({ scope: "category", categoryId: "food", averagePaise: 4033_33, suggestedPaise: 4500_00, months: ["2026-07", "2026-08", "2026-09"] });
    expect(s).toContainEqual(expect.objectContaining({ scope: "overall", suggestedPaise: 4500_00 }));
    expect(suggestBudgets(items, "2026-10", "2026-08-01")).toBeNull();
  });
});
