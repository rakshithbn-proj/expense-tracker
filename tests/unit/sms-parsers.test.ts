import { describe, expect, it } from "vitest";
import { nameKey } from "@/server/env";
import { asOwnTransfer } from "@/server/ingestion/ingest";
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

  // ICICI bank-account debit with an "Info" channel and no payee (digits and balance replaced).
  const iciciNeft =
    "ICICI Bank Acc XX123 debited Rs. 32,000.00 on 07-Nov-26 InfoBIL*NEFT*IN12.Avl Bal Rs. 60,000.92.To dispute call 18002662 or SMS BLOCK 123 to 9215676766";

  it("reads an ICICI bank-account NEFT debit, from the SMS and from its masked excerpt", () => {
    for (const text of [iciciNeft, maskExcerpt(iciciNeft)]) {
      const r = parseSms(text, new Date("2026-11-07T01:48:00Z"));
      expect(r?.kind === "transaction" && r.alert).toMatchObject({
        parserId: "icici.sms_acc_info_debit",
        institutionKey: "icici",
        accountType: "bank_account",
        accountLast: "123",
        amountPaise: 32_000_00,
        direction: "debit",
        merchant: null,
        transactionDate: "2026-11-07",
        paymentMethod: "net_banking",
        uncertain: [],
      });
    }
  });

  it("doesn't read a future autopay notice as a payment", () => {
    expect(
      parseSms("ICICI Bank SAVINGS Account XX123 will be debited for Rs 75.00 on 14-Nov-26 towards Autopay for APPLE MEDIA SER, Create Mandate", received),
    ).toBeNull();
  });

  // The first real SBI SMS format, with the payee, account digits and balance replaced.
  const sbi = "Your A/C XXXXX123456 Debited INR 16,800.00 on 10/11/26 -Transferred to Mr. ARUN K S. Avl Balance INR 70,000.95-SBI";

  it("reads an SBI bank-account transfer debit", () => {
    const r = parseSms(sbi, new Date("2026-11-10T02:27:00Z"));
    expect(r?.kind === "transaction" && r.alert).toMatchObject({
      parserId: "sbi.sms_acct_transfer_debit",
      institutionKey: "sbi",
      institutionName: "State Bank of India",
      accountType: "bank_account",
      accountLast: "3456",
      amountPaise: 16_800_00,
      direction: "debit",
      transactionType: "purchase",
      merchant: "ARUN K S",
      transactionDate: "2026-11-10",
      paymentMethod: "unknown",
      uncertain: [],
    });
  });

  it("reads the SBI SMS from its masked excerpt too (Retry)", () => {
    const masked = maskExcerpt(sbi);
    expect(masked).toContain("XXXXX••3456");
    expect(parseSms(masked, new Date("2026-11-10T02:27:00Z"))).toMatchObject({ kind: "transaction", alert: { accountLast: "3456", amountPaise: 16_800_00, merchant: "ARUN K S" } });
  });

  it("treats a payment to or from the user's own name as an own-account transfer", () => {
    const own = [nameKey("ARUNK S"), nameKey("Arun Kumar")];
    expect(nameKey("Mr. ARUN K S.")).toBe("ARUNKS");
    expect(nameKey("MRUTHULA")).toBe("MRUTHULA"); // a name starting with "Mr" keeps it
    expect(asOwnTransfer({ merchant: "ARUN K S", transactionType: "purchase" }, own).transactionType).toBe("internal_transfer");
    expect(asOwnTransfer({ merchant: "arun kumar", transactionType: "income" }, own).transactionType).toBe("internal_transfer");
    expect(asOwnTransfer({ merchant: "RAVI KUMAR S", transactionType: "purchase" }, own).transactionType).toBe("purchase");
    expect(asOwnTransfer({ merchant: "ARUN K S", transactionType: "refund" }, own).transactionType).toBe("refund");
    expect(asOwnTransfer({ merchant: "ARUN K S", transactionType: "purchase" }, []).transactionType).toBe("purchase");
  });

  it("doesn't guess at formats it hasn't seen", () => {
    expect(parseSms("Rs.2000.00 debited from A/c XX1234 on 24-10-26 to VPA someone@okaxis", received)).toBeNull();
  });
});
