import { describe, expect, it } from "vitest";
import { flatten, htmlToText } from "@/server/ingestion/email/html-text";
import { emailAddress, toAlertEmail } from "@/server/ingestion/email/gmail-message";
import { istTimestamp, looksLikeTransaction, parseDayFirst, parseMonthName } from "@/server/ingestion/email/parse-helpers";
import { gmailSenderQuery, parseAlert, PARSERS } from "@/server/ingestion/email/registry";
import type { AlertEmail } from "@/server/ingestion/email/types";
import { loadEmailFixtures, toGmailMessage } from "../support/email-fixtures";

const fixtures = loadEmailFixtures();

describe("real alert formats (redacted fixtures)", () => {
  it("has a fixture for every parser", () => {
    for (const p of PARSERS) expect(fixtures.some((f) => f.file.startsWith(`${p.id}/`)), p.id).toBe(true);
  });

  for (const f of fixtures) {
    it(`parses ${f.file}`, () => {
      expect(f.expected, "fixture has no expected result").toBeDefined();
      const result = parseAlert(toAlertEmail(toGmailMessage(f)));
      expect(result.kind).toBe("transaction");
      if (result.kind !== "transaction") return;
      const { sourceTimestamp, description, institutionName, ...rest } = result.alert;
      expect({ ...rest, sourceTimestamp: sourceTimestamp?.toISOString() ?? null }).toEqual(f.expected);
      expect(description.length).toBeGreaterThan(20);
      expect(institutionName).toBeTruthy();
    });
  }
});

describe("format changes and other mail never disappear silently", () => {
  const base = fixtures.find((f) => f.file === "hdfc/card-debit-1.json")!;
  const email = (patch: Partial<AlertEmail>): AlertEmail => ({ ...toAlertEmail(toGmailMessage(base)), ...patch });

  it("a reworded transaction alert from a known bank goes to review", () => {
    const r = parseAlert(email({ text: "Rs. 500.00 was charged to your card ending 7788 at SOMEWHERE on 08-10-2026", subject: "Card transaction" }));
    expect(r).toMatchObject({ kind: "unrecognized" });
  });

  it("an HDFC bank-account alert (no parser yet) goes to review, not the bin", () => {
    const r = parseAlert(email({ subject: "View: Account update for your HDFC Bank A/c", text: "Rs. 2,000.00 has been debited from account **1234 to VPA someone@okaxis on 20-10-26." }));
    expect(r.kind).toBe("unrecognized");
  });

  it("a promotional email from a bank sender is ignored", () => {
    const r = parseAlert(email({ subject: "Exclusive offers this festive season", text: "Discover new rewards on your card. Apply now." }));
    expect(r.kind).toBe("not_transaction");
  });

  it("an OTP email is not a transaction, even though it shows an amount", () => {
    // Wording from a real HSBC OTP email; code and card are made up.
    const otp = email({
      fromAddress: "hsbc@hsbc.bank.in",
      subject: "Your HSBC Credit Card OTP",
      text: "A One-Time Password (OTP) has been generated for a transaction on your HSBC Credit Card ending with 1122. This OTP is valid for 5 minutes.\nOTP: 123456\nTransaction details:\nAmount: INR 100.00\nMerchant: SAMPLE MERCHANT",
    });
    expect(parseAlert(otp)).toEqual({ kind: "not_transaction", reason: "hsbc: one-time password, not a completed payment" });
  });

  it("mail from an unknown sender is ignored", () => {
    expect(parseAlert(email({ fromAddress: "news@shop.example" })).kind).toBe("not_transaction");
  });

  it("an impossible date is unrecognized rather than guessed", () => {
    const r = parseAlert(email({ text: "Rs. 10.00 has been debited from your HDFC Bank Credit Card ending 7788 towards X on 31 Feb, 2026 at 10:00:00" }));
    expect(r).toMatchObject({ kind: "unrecognized" });
  });

  it("flags a date far from when the email arrived", () => {
    const r = parseAlert(email({ text: "Rs. 10.00 has been debited from your HDFC Bank Credit Card ending 7788 towards X on 08 Oct, 2025 at 10:00:00" }));
    expect(r.kind === "transaction" && r.alert.uncertain).toEqual(["transaction date far from email date"]);
  });

  it("keeps a foreign currency rather than assuming INR", () => {
    const hsbc = fixtures.find((f) => f.file.startsWith("hsbc/"))!;
    const e = toAlertEmail(toGmailMessage(hsbc));
    const r = parseAlert({ ...e, text: e.text.replace("INR 90.00", "USD 12.50") });
    expect(r.kind === "transaction" && [r.alert.currency, r.alert.amountPaise]).toEqual(["USD", 1250]);
  });
});

describe("helpers", () => {
  it("decodes Gmail messages, preferring HTML", () => {
    const email = toAlertEmail(toGmailMessage(fixtures[0]));
    expect(email.fromAddress).toMatch(/@/);
    expect(email.text).not.toMatch(/<[a-z]/i);
    expect(emailAddress("HDFC Bank InstaAlerts <Alerts@HDFCbank.bank.in>")).toBe("alerts@hdfcbank.bank.in");
  });

  it("turns HTML into readable text with entities decoded", () => {
    const t = htmlToText("<style>p{}</style><p>Rs.&nbsp;1,000.00&#160;spent</p><br>at <b>A&amp;B</b><!-- x -->");
    expect(flatten(t)).toBe("Rs. 1,000.00 spent at A&B");
  });

  it("parses Indian date styles and India-time clocks", () => {
    expect(parseDayFirst("16-10-26")).toBe("2026-10-16");
    expect(parseDayFirst("22/10/26")).toBe("2026-10-22");
    expect(parseDayFirst("11-10-2026")).toBe("2026-10-11");
    expect(parseDayFirst("31-02-2026")).toBeNull();
    expect(parseMonthName("08 Oct, 2026")).toBe("2026-10-08");
    expect(parseMonthName("Oct 01, 2026")).toBe("2026-10-01");
    expect(istTimestamp("2026-10-08", "11:23:10")?.toISOString()).toBe("2026-10-08T05:53:10.000Z");
    expect(istTimestamp("2026-10-08", "25:00")).toBeNull();
  });

  it("recognises transaction-like text", () => {
    expect(looksLikeTransaction("INR 500 debited from your account", "")).toBe(true);
    expect(looksLikeTransaction("Your statement is ready", "Statement")).toBe(false);
  });

  it("builds one Gmail query covering every known sender", () => {
    const q = gmailSenderQuery();
    for (const p of PARSERS) for (const s of p.senders) expect(q).toContain(s);
  });
});
