import { describe, expect, it } from "vitest";
import { normalizeMerchant, normalizeRuleValue } from "@/server/finance/merchant";
import { matchCategoryRule, type RuleLike } from "@/server/finance/rules";

describe("normalizeMerchant", () => {
  it.each([
    ["Swiggy", "SWIGGY"],
    ["UPI/SWIGGY", "SWIGGY"],
    ["UPI-swiggy@icici", "SWIGGY"],
    ["POS 412345XXXXXX1234 BIGBASKET BANGALORE", "BIGBASKET BANGALORE"],
    ["AMAZON PAY INDIA PVT LTD", "AMAZON PAY INDIA"],
    ["Zomato Ltd.", "ZOMATO"],
    ["UPI/123456789012/Uber India/uber@axis", "UBER INDIA UBER"],
    ["NETFLIX.COM", "NETFLIX COM"],
    ["   ", null],
    [null, null],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it("keeps short numbers that are part of a name", () => {
    expect(normalizeMerchant("Cafe 1947")).toBe("CAFE 1947");
  });
});

const rule = (overrides: Partial<RuleLike>): RuleLike => ({
  id: crypto.randomUUID(),
  matchType: "merchant_contains",
  matchValue: "X",
  categoryId: "cat",
  priority: 100,
  isActive: true,
  createdAt: new Date("2026-01-01"),
  ...overrides,
});

describe("matchCategoryRule", () => {
  const input = { merchantNormalized: "SWIGGY INSTAMART", originalDescription: "UPI payment to swiggy instamart" };

  it("matches exact, contains and description rules", () => {
    expect(matchCategoryRule([rule({ matchType: "merchant_exact", matchValue: "SWIGGY INSTAMART", categoryId: "g" })], input)?.categoryId).toBe("g");
    expect(matchCategoryRule([rule({ matchType: "merchant_exact", matchValue: "SWIGGY", categoryId: "g" })], input)).toBeNull();
    expect(matchCategoryRule([rule({ matchValue: "INSTAMART", categoryId: "g" })], input)?.categoryId).toBe("g");
    expect(matchCategoryRule([rule({ matchType: "description_contains", matchValue: "UPI PAYMENT TO", categoryId: "d" })], input)?.categoryId).toBe("d");
  });

  it("prefers higher priority, then the older rule, regardless of input order", () => {
    const food = rule({ matchValue: "SWIGGY", categoryId: "food", priority: 100, createdAt: new Date("2026-01-01") });
    const groceries = rule({ matchValue: "INSTAMART", categoryId: "groceries", priority: 200 });
    expect(matchCategoryRule([food, groceries], input)?.categoryId).toBe("groceries");
    expect(matchCategoryRule([groceries, food], input)?.categoryId).toBe("groceries");

    const older = rule({ matchValue: "SWIGGY", categoryId: "older", createdAt: new Date("2025-01-01") });
    const newer = rule({ matchValue: "INSTAMART", categoryId: "newer", createdAt: new Date("2026-06-01") });
    expect(matchCategoryRule([newer, older], input)?.categoryId).toBe("older");
  });

  it("ignores inactive rules and returns null when nothing matches", () => {
    expect(matchCategoryRule([rule({ matchValue: "SWIGGY", isActive: false })], input)).toBeNull();
    expect(matchCategoryRule([rule({ matchValue: "ZOMATO" })], input)).toBeNull();
    expect(matchCategoryRule([rule({ matchValue: "SWIGGY" })], { merchantNormalized: null, originalDescription: null })).toBeNull();
  });

  it("normalizes rule values the same way as merchants", () => {
    expect(normalizeRuleValue("merchant_exact", "upi/Swiggy@icici")).toBe("SWIGGY");
    expect(normalizeRuleValue("description_contains", "  bill   payment ")).toBe("BILL PAYMENT");
  });
});
