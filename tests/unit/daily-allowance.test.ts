import { describe, expect, it } from "vitest";
import { allowanceToday, projectCap, type AllowanceMonth } from "@/lib/daily-allowance";

const R = (rupees: number) => rupees * 100;
// November has 30 days, so a ₹30,000 budget is ₹1,000 a day.
const nov = (spend: Record<number, number> = {}, limit = 30_000): AllowanceMonth => ({
  month: "2026-11",
  limitPaise: R(limit),
  dailySpendPaise: Array.from({ length: 30 }, (_, i) => R(spend[i + 1] ?? 0)),
});

describe("daily allowance", () => {
  it("credits an even share on day 1", () => {
    const t = allowanceToday([nov()], "2026-11-01", R(30_000));
    expect(t.creditTodayPaise).toBe(R(1_000));
    expect(t.availableTodayPaise).toBe(R(1_000));
    expect(projectCap(t).capPaise).toBe(R(1_000));
  });

  it("carries unspent money in full to the next day", () => {
    const t = allowanceToday([nov({ 1: 800 })], "2026-11-02", R(30_000));
    expect(t.carriedToTodayPaise).toBe(R(200));
    expect(t.availableTodayPaise).toBe(R(1_200));
  });

  it("spreads an overspend over the remaining days instead of hitting one day", () => {
    const t = allowanceToday([nov({ 1: 1_200 })], "2026-11-02", R(30_000));
    // ₹200 over, spread over 29 days: (29,000 − 200) / 29
    expect(t.carriedToTodayPaise).toBe(0);
    expect(t.creditTodayPaise).toBe(Math.floor(R(28_800) / 29));
  });

  it("closes the day at zero after a big payment and lowers later credits (rent late in the month)", () => {
    // Days 1–19 spent exactly ₹1,000; day 20 rent ₹3,000 → ₹11,000 − 3,000 = ₹8,000 over 10 days.
    const spend: Record<number, number> = {};
    for (let d = 1; d <= 19; d++) spend[d] = 1_000;
    const t = allowanceToday([nov({ ...spend, 20: 3_000 })], "2026-11-21", R(30_000));
    expect(t.carriedToTodayPaise).toBe(0);
    expect(t.creditTodayPaise).toBe(R(800));
  });

  it("adds a refund back to its day", () => {
    const t = allowanceToday([nov({ 1: -500 })], "2026-11-02", R(30_000));
    expect(t.carriedToTodayPaise).toBe(R(1_500));
  });

  it("carries a monthly leftover into next month, spread over its days", () => {
    const dec: AllowanceMonth = { month: "2026-12", limitPaise: R(31_000), dailySpendPaise: new Array(31).fill(0) };
    const spend: Record<number, number> = {};
    for (let d = 1; d <= 30; d++) spend[d] = 900; // ₹3,000 left at the end of November
    const t = allowanceToday([nov(spend), dec], "2026-12-01", R(31_000));
    expect(t.carryInPaise).toBe(R(3_000));
    expect(t.creditTodayPaise).toBe(Math.floor(R(34_000) / 31));
  });

  it("takes an overspend from next month, even across several months", () => {
    const dec: AllowanceMonth = { month: "2026-12", limitPaise: R(31_000), dailySpendPaise: new Array(31).fill(0) };
    dec.dailySpendPaise[30] = R(31_000 + 60_000); // 31 Dec: ₹60,000 over
    const novSpent = nov({ 30: 30_000 });
    const jan: AllowanceMonth = { month: "2027-01", limitPaise: R(31_000), dailySpendPaise: new Array(31).fill(0) };
    const t = allowanceToday([novSpent, dec, jan], "2027-01-01", R(31_000));
    expect(t.carryInPaise).toBe(R(-60_000));
    expect(t.creditTodayPaise).toBe(0); // January's whole budget goes to the deficit
    expect(projectCap(t).takenFromNextMonthPaise).toBe(R(29_000));
  });
});

describe("calculator", () => {
  it("says how much a big expense lowers the daily cap", () => {
    const spend: Record<number, number> = {};
    for (let d = 1; d <= 20; d++) spend[d] = 1_000;
    const t = allowanceToday([nov(spend)], "2026-11-21", R(30_000)); // ₹10,000 left for days 21–30
    expect(t.availableTodayPaise).toBe(R(1_000));
    const before = projectCap(t);
    expect(before.capPaise).toBe(R(1_000)); // ₹9,000 still to hand out over 9 days
    const after = projectCap(t, R(4_000)); // ₹3,000 more than today's ₹1,000
    expect(after.capPaise).toBe(Math.floor(R(6_000) / 9));
    expect(after.leftTodayPaise).toBe(R(-3_000));
  });

  it("leaves the cap alone when the expense fits in today's allowance", () => {
    const t = allowanceToday([nov()], "2026-11-01", R(30_000));
    const after = projectCap(t, R(600));
    expect(after.capPaise).toBe(projectCap(t).capPaise);
    expect(after.leftTodayPaise).toBe(R(400));
  });

  it("on the last day, reports next month's cap", () => {
    const spend: Record<number, number> = {};
    for (let d = 1; d <= 29; d++) spend[d] = 1_000;
    const t = allowanceToday([nov(spend)], "2026-11-30", R(31_000));
    expect(projectCap(t)).toMatchObject({ scope: "next-month", capPaise: Math.floor(R(32_000) / 31), days: 31 }); // ₹1,000 unspent today moves over
    expect(projectCap(t, R(4_100)).capPaise).toBe(Math.floor(R(31_000 - 3_100) / 31));
  });
});
