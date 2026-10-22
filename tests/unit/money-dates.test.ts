import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, istDate, isValidDate, isValidMonth, monthRange } from "@/lib/dates";
import { decimalToPaise, formatInr, MoneyParseError, paiseToDecimal, parseAmountToPaise } from "@/lib/money";

describe("parseAmountToPaise", () => {
  it.each([
    ["1,23,456.78", 12_345_678],
    ["₹ 500", 50_000],
    ["₹500.5", 50_050],
    ["Rs. 1,000", 100_000],
    ["Rs 1000.00", 100_000],
    ["INR 250", 25_000],
    ["250/-", 25_000],
    ["0.01", 1],
    ["007", 700],
  ])("%s -> %i paise", (input, paise) => {
    expect(parseAmountToPaise(input)).toBe(paise);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.3.4", "₹", "1,00,00,00,00,00,000"])("rejects %j", (input) => {
    expect(() => parseAmountToPaise(input)).toThrow(MoneyParseError);
  });

  it("never uses floating point (0.1 + 0.2 style errors)", () => {
    expect(parseAmountToPaise("0.10") + parseAmountToPaise("0.20")).toBe(30);
    expect(parseAmountToPaise("1234567890.99")).toBe(123_456_789_099);
  });
});

describe("decimal conversions", () => {
  it.each([
    ["1234.50", 123_450],
    ["0.05", 5],
    ["-12.00", -1_200],
    ["7", 700],
  ])("decimalToPaise(%s)", (dec, paise) => expect(decimalToPaise(dec)).toBe(paise));

  it.each([
    [123_450, "1234.50"],
    [5, "0.05"],
    [-1_200, "-12.00"],
    [0, "0.00"],
  ])("paiseToDecimal(%i)", (paise, dec) => expect(paiseToDecimal(paise)).toBe(dec));

  it("rejects non-integer paise", () => {
    expect(() => paiseToDecimal(1.5)).toThrow();
  });

  it("formats with Indian digit grouping", () => {
    expect(formatInr(12_345_678)).toBe("₹1,23,456.78");
  });
});

describe("dates in India time", () => {
  it("uses Asia/Kolkata for the calendar date", () => {
    // 20:00 UTC on 31 Oct is 01:30 IST on 1 Nov.
    expect(istDate(new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
    expect(istDate(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10-31");
  });

  it("builds half-open month ranges, including year ends", () => {
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 14)).toBe("2027-12");
  });

  it("validates dates and months", () => {
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-12")).toBe(true);
  });

  it("does day arithmetic across month ends", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
  });
});
