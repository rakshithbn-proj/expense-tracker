import { describe, expect, it } from "vitest";
import { maskExcerpt } from "@/server/ingestion/mask";
import { parseSms } from "@/server/ingestion/sms/parsers";

const received = new Date("2026-10-26T11:19:00Z");
// The first real ICICI SMS format, with the payee, account digits and reference replaced.
const icici =
  "ICICI Bank Acct XX123 debited for Rs 5.00 on 26-Oct-26; RAVI KUMAR S  credited. UPI:630099990001. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.";

describe("bank SMS parsers", () => {
  it("reads an ICICI bank-account UPI debit", () => {
    const r = parseSms(icici, received);
    expect(r?.kind).toBe("transaction");
    if (r?.kind !== "transaction") return;
    expect(r.alert).toMatchObject({
      parserId: "icici.sms_acct_upi_debit",
      institutionKey: "icici",
      accountType: "bank_account",
      accountLast: "123",
      amountPaise: 500,
      direction: "debit",
      merchant: "RAVI KUMAR S",
      transactionDate: "2026-10-26",
      paymentMethod: "upi",
      referenceId: "630099990001",
      uncertain: [],
    });
  });

  it("reads the masked excerpt kept for review, without the lost reference", () => {
    const r = parseSms(maskExcerpt(icici), received);
    expect(r?.kind === "transaction" && r.alert).toMatchObject({ amountPaise: 500, accountLast: "123", referenceId: null });
  });

  it("doesn't guess at formats it hasn't seen", () => {
    expect(parseSms("Rs.2000.00 debited from A/c XX1234 on 24-10-26 to VPA someone@okaxis", received)).toBeNull();
  });
});
