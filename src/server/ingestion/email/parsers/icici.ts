import { flatten } from "../html-text";
import { amount, cleanMerchant, dateUncertainty, istTimestamp, parseMonthName } from "../parse-helpers";
import type { AlertParser, ParseResult } from "../types";

const base = { institutionKey: "icici", institutionName: "ICICI Bank" } as const;

// "Your ICICI Bank Credit Card XX3344 has been used for a transaction of INR 892.04 on Oct 01, 2026
// at 09:02:39. Info: AMAZON PAY IN E COMMERCE. The Available Credit Limit ..."
const CARD =
  /Your ICICI Bank Credit Card XX(\d{4}) has been used for a transaction of ([A-Z]{3}) ([\d,]+(?:\.\d{1,2})?) on ([A-Za-z]{3} \d{1,2}, \d{4}) at (\d{1,2}:\d{2}(?::\d{2})?)\.\s*Info:\s*(.+?)\.\s+(?=The Available|In case|$)/i;

export const iciciParser: AlertParser = {
  id: "icici",
  ...base,
  senders: ["credit_cards@icici.bank.in", "credit_cards@icicibank.com"],
  description: "ICICI Bank credit card transaction alerts (bank-account alerts not yet seen)",
  parse(email): ParseResult | null {
    const m = CARD.exec(flatten(email.text));
    if (!m) return null;
    const date = parseMonthName(m[4]);
    if (!date) return { kind: "unrecognized", reason: `icici card: unreadable date "${m[4]}"` };
    return {
      kind: "transaction",
      alert: {
        parserId: "icici.card",
        ...base,
        accountType: "credit_card",
        accountLast: m[1],
        amountPaise: amount(m[3]),
        currency: m[2].toUpperCase(),
        direction: "debit",
        transactionType: "purchase",
        status: "posted",
        merchant: cleanMerchant(m[6]),
        description: m[0].trim(),
        transactionDate: date,
        sourceTimestamp: istTimestamp(date, m[5]),
        paymentMethod: "credit_card",
        referenceId: null,
        uncertain: dateUncertainty(date, email.receivedAt),
      },
    };
  },
};
