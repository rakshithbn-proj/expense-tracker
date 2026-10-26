import { amount, cleanMerchant, dateUncertainty, parseMonthName } from "../email/parse-helpers";
import type { ParsedAlert, ParseResult } from "../email/types";

// Bank SMS formats, each written from a real SMS. Matched on the text alone: the Shortcut that
// forwards them is authenticated by its device key, and Indian bank sender IDs are registered.

const icici = { institutionKey: "icici", institutionName: "ICICI Bank" } as const;

// "ICICI Bank Acct XX123 debited for Rs 5.00 on 26-Oct-26; RAVI KUMAR S credited. UPI:630012345678.
// Call 18002662 for dispute. SMS BLOCK 123 to 9215676766."
const ICICI_ACCT_UPI_DEBIT =
  /ICICI Bank Acct XX(\d{2,6}) debited for (?:Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?) on (\d{1,2}-[A-Za-z]{3}-\d{2,4}); (.+?) credited\.(?:\s*UPI:\s*([^\s.]+))?/i;

export function parseSms(text: string, receivedAt: Date): ParseResult | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = ICICI_ACCT_UPI_DEBIT.exec(flat);
  if (!m) return null;
  const date = parseMonthName(m[3]);
  if (!date) return { kind: "unrecognized", reason: `icici sms: unreadable date "${m[3]}"` };
  const alert: ParsedAlert = {
    parserId: "icici.sms_acct_upi_debit",
    ...icici,
    accountType: "bank_account",
    accountLast: m[1],
    amountPaise: amount(m[2]),
    currency: "INR",
    direction: "debit",
    transactionType: "purchase",
    status: "posted",
    // The payee's name as the bank states it; the SMS doesn't say which UPI app was used.
    merchant: cleanMerchant(m[4]),
    description: m[0].trim(),
    transactionDate: date,
    sourceTimestamp: null,
    paymentMethod: "upi",
    // A masked excerpt (replayed on Retry) has lost the reference digits.
    referenceId: m[5] && /^\d{6,}$/.test(m[5]) ? m[5] : null,
    uncertain: dateUncertainty(date, receivedAt),
  };
  return { kind: "transaction", alert };
}
