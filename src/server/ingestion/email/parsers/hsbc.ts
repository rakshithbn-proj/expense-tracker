import { flatten } from "../html-text";
import { amount, cleanMerchant, dateUncertainty, parseDayFirst } from "../parse-helpers";
import type { AlertParser, ParseResult } from "../types";

const base = { institutionKey: "hsbc", institutionName: "HSBC" } as const;

// "your HSBC Credit Card xx1122 was used for a transaction of INR 90.00 at SAMPLE CLINIC on 22/10/26."
const CARD = /your HSBC Credit Card xx(\d{4}) was used for a transaction of ([A-Z]{3}) ([\d,]+(?:\.\d{1,2})?) at (.+?) on (\d{1,2}\/\d{1,2}\/\d{2,4})\./i;

export const hsbcParser: AlertParser = {
  id: "hsbc",
  ...base,
  senders: ["hsbc@hsbc.bank.in", "hsbc@mail.hsbc.co.in"],
  description: "HSBC India credit card transaction alerts",
  parse(email): ParseResult | null {
    const m = CARD.exec(flatten(email.text));
    if (!m) return null;
    const date = parseDayFirst(m[5]);
    if (!date) return { kind: "unrecognized", reason: `hsbc card: unreadable date "${m[5]}"` };
    return {
      kind: "transaction",
      alert: {
        parserId: "hsbc.card",
        ...base,
        accountType: "credit_card",
        accountLast: m[1],
        amountPaise: amount(m[3]),
        currency: m[2].toUpperCase(),
        direction: "debit",
        transactionType: "purchase",
        status: "posted",
        merchant: cleanMerchant(m[4]),
        description: m[0].trim(),
        transactionDate: date,
        // HSBC states only the date, not the time.
        sourceTimestamp: null,
        paymentMethod: "credit_card",
        referenceId: null,
        uncertain: dateUncertainty(date, email.receivedAt),
      },
    };
  },
};
