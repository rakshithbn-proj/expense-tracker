import { flatten } from "../html-text";
import { amount, cleanMerchant, dateUncertainty, parseDayFirst } from "../parse-helpers";
import type { AlertParser, ParseResult } from "../types";

const base = { institutionKey: "rbl", institutionName: "RBL Bank" } as const;

// "INR1,000.00 spent at SAMPLE ENTERPRISES on RBL Bank credit card (6060) on 11-10-2026."
const CARD = /([A-Z]{3})\s?([\d,]+(?:\.\d{1,2})?) spent at (.+?) on RBL Bank credit card \((\d{4})\) on (\d{1,2}-\d{1,2}-\d{2,4})/i;

export const rblParser: AlertParser = {
  id: "rbl",
  ...base,
  senders: ["rblalerts@rbl.bank.in", "rblalerts@rblbank.com"],
  description: "RBL Bank credit card swipe alerts",
  parse(email): ParseResult | null {
    const m = CARD.exec(flatten(email.text));
    if (!m) return null;
    const date = parseDayFirst(m[5]);
    if (!date) return { kind: "unrecognized", reason: `rbl card: unreadable date "${m[5]}"` };
    return {
      kind: "transaction",
      alert: {
        parserId: "rbl.card",
        ...base,
        accountType: "credit_card",
        accountLast: m[4],
        amountPaise: amount(m[2]),
        currency: m[1].toUpperCase(),
        direction: "debit",
        transactionType: "purchase",
        status: "posted",
        merchant: cleanMerchant(m[3]),
        description: m[0].trim(),
        transactionDate: date,
        sourceTimestamp: null,
        paymentMethod: "credit_card",
        referenceId: null,
        uncertain: dateUncertainty(date, email.receivedAt),
      },
    };
  },
};
