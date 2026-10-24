import { flatten } from "../html-text";
import { amount, cleanMerchant, dateUncertainty, istTimestamp, parseDayFirst, parseMonthName } from "../parse-helpers";
import type { AlertParser, ParseResult } from "../types";

const base = { institutionKey: "hdfc", institutionName: "HDFC Bank" } as const;

// Card purchase: "Rs. 412.75 has been debited from your HDFC Bank Credit Card ending 7788 towards
// BOOK MY SHOW SMART GAT on 08 Oct, 2026 at 11:23:10 ."
const CARD_DEBIT =
  /Rs\.?\s?([\d,]+(?:\.\d{1,2})?) has been debited from your HDFC Bank Credit Card ending (\d{4}) towards (.+?) on (\d{1,2} [A-Za-z]{3},? \d{4}) at (\d{1,2}:\d{2}(?::\d{2})?)/i;

// RuPay credit card used over UPI: "Rs.245.50 has been debited from your RuPay Credit Card (ending 4321)
// Paid to ******9999@ybl Date: 16-10-26 UPI Transaction Reference Number: 600000000001"
const RUPAY_UPI =
  /Rs\.?\s?([\d,]+(?:\.\d{1,2})?) has been debited from your RuPay Credit Card \(ending (\d{4})\) Paid to (\S+) Date: (\d{1,2}-\d{1,2}-\d{2,4}) UPI Transaction Reference Number: (\d{6,20})/i;

export const hdfcParser: AlertParser = {
  id: "hdfc",
  ...base,
  senders: ["alerts@hdfcbank.bank.in", "alerts@hdfcbank.net"],
  description: "HDFC Bank credit card alerts: card purchases and RuPay credit card UPI payments",
  parse(email): ParseResult | null {
    const text = flatten(email.text);

    let m = CARD_DEBIT.exec(text);
    if (m) {
      const date = parseMonthName(m[4]);
      if (!date) return { kind: "unrecognized", reason: `hdfc card debit: unreadable date "${m[4]}"` };
      return {
        kind: "transaction",
        alert: {
          parserId: "hdfc.card_debit",
          ...base,
          accountType: "credit_card",
          accountLast: m[2],
          amountPaise: amount(m[1]),
          currency: "INR",
          direction: "debit",
          transactionType: "purchase",
          status: "posted",
          merchant: cleanMerchant(m[3]),
          description: m[0].trim(),
          transactionDate: date,
          sourceTimestamp: istTimestamp(date, m[5]),
          paymentMethod: "credit_card",
          referenceId: null,
          uncertain: dateUncertainty(date, email.receivedAt),
        },
      };
    }

    m = RUPAY_UPI.exec(text);
    if (m) {
      const date = parseDayFirst(m[4]);
      if (!date) return { kind: "unrecognized", reason: `hdfc rupay upi: unreadable date "${m[4]}"` };
      return {
        kind: "transaction",
        alert: {
          parserId: "hdfc.rupay_upi",
          ...base,
          accountType: "credit_card",
          accountLast: m[2],
          amountPaise: amount(m[1]),
          currency: "INR",
          direction: "debit",
          transactionType: "purchase",
          status: "posted",
          // The payee's UPI ID is all the alert gives. It names the payee's handle, not the app
          // used to pay, so no payment app is inferred from it.
          merchant: cleanMerchant(m[3]),
          description: m[0].trim(),
          transactionDate: date,
          sourceTimestamp: null,
          paymentMethod: "upi",
          referenceId: m[5],
          uncertain: dateUncertainty(date, email.receivedAt),
        },
      };
    }
    return null;
  },
};
