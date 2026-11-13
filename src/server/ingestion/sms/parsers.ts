import { amount, cleanMerchant, dateUncertainty, parseDayFirst, parseMonthName } from "../email/parse-helpers";
import type { ParsedAlert, ParseResult } from "../email/types";

// Bank SMS formats, each written from a real SMS. Matched on the text alone: the Shortcut that
// forwards them is authenticated by its device key, and Indian bank sender IDs are registered.

const icici = { institutionKey: "icici", institutionName: "ICICI Bank" } as const;

// "ICICI Bank Acct XX123 debited for Rs 5.00 on 26-Oct-26; RAVI KUMAR S credited. UPI:630012345678.
// Call 18002662 for dispute. SMS BLOCK 123 to 9215676766."
const ICICI_ACCT_UPI_DEBIT =
  /ICICI Bank Acct XX(\d{2,6}) debited for (?:Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?) on (\d{1,2}-[A-Za-z]{3}-\d{2,4}); (.+?) credited\.(?:\s*UPI:\s*([^\s.]+))?/i;

// "ICICI Bank Acc XX123 debited Rs. 32,000.00 on 07-Nov-26 InfoBIL*NEFT*IN12.Avl Bal Rs. 60,000.92.
// To dispute call 18002662 or SMS BLOCK 123 to 9215676766". The "Info" text names the channel,
// not a payee.
const ICICI_ACC_INFO_DEBIT =
  /ICICI Bank Acc XX(\d{2,6}) debited (?:Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?) on (\d{1,2}-[A-Za-z]{3}-\d{2,4}) ?Info ?(.+?)\.\s?Avl Bal/i;

const channelMethod = (info: string) =>
  /\b(?:NEFT|IMPS|RTGS)\b|\*(?:NEFT|IMPS|RTGS)\*/i.test(info) ? ("net_banking" as const) : /\bUPI\b/i.test(info) ? ("upi" as const) : ("unknown" as const);

const sbi = { institutionKey: "sbi", institutionName: "State Bank of India" } as const;

// "Your A/C XXXXX123456 Debited INR 16,800.00 on 10/11/26 -Transferred to Mr. A B KUMAR.
// Avl Balance INR 73,989.95-SBI". The account digits may already be masked ("XXXXX••3456") when
// a kept excerpt is replayed, so only the last four are read.
const SBI_ACCT_TRANSFER_DEBIT =
  /Your A\/C [X*•\d]*?(\d{4}) Debited INR ([\d,]+(?:\.\d{1,2})?) on (\d{1,2}\/\d{1,2}\/\d{2,4}) ?-? ?Transferred to (.+?)\.? Avl Bal(?:ance)? INR [\d,]+(?:\.\d{1,2})? ?-? ?SBI\b/i;

const withoutTitle = (name: string) => name.replace(/^(?:Mr|Mrs|Ms|Dr)(?:\.\s*|\s+)/i, "");

export function parseSms(text: string, receivedAt: Date): ParseResult | null {
  const flat = text.replace(/\s+/g, " ").trim();
  return parseIciciAcctUpiDebit(flat, receivedAt) ?? parseIciciAccInfoDebit(flat, receivedAt) ?? parseSbiAcctTransferDebit(flat, receivedAt);
}

function parseIciciAccInfoDebit(flat: string, receivedAt: Date): ParseResult | null {
  const m = ICICI_ACC_INFO_DEBIT.exec(flat);
  if (!m) return null;
  const date = parseMonthName(m[3]);
  if (!date) return { kind: "unrecognized", reason: `icici sms: unreadable date "${m[3]}"` };
  const alert: ParsedAlert = {
    parserId: "icici.sms_acc_info_debit",
    ...icici,
    accountType: "bank_account",
    accountLast: m[1],
    amountPaise: amount(m[2]),
    currency: "INR",
    direction: "debit",
    transactionType: "purchase",
    status: "posted",
    // No payee in this format; the description keeps the bank's "Info" text.
    merchant: null,
    description: `ICICI Bank Acc XX${m[1]} debited ${m[2]} on ${m[3]} Info ${m[4].trim()}`,
    transactionDate: date,
    sourceTimestamp: null,
    paymentMethod: channelMethod(m[4]),
    referenceId: null,
    uncertain: dateUncertainty(date, receivedAt),
  };
  return { kind: "transaction", alert };
}

function parseSbiAcctTransferDebit(flat: string, receivedAt: Date): ParseResult | null {
  const m = SBI_ACCT_TRANSFER_DEBIT.exec(flat);
  if (!m) return null;
  const date = parseDayFirst(m[3]);
  if (!date) return { kind: "unrecognized", reason: `sbi sms: unreadable date "${m[3]}"` };
  const alert: ParsedAlert = {
    parserId: "sbi.sms_acct_transfer_debit",
    ...sbi,
    accountType: "bank_account",
    accountLast: m[1],
    amountPaise: amount(m[2]),
    currency: "INR",
    direction: "debit",
    // A transfer to the user's own name becomes an own-account transfer at ingestion.
    transactionType: "purchase",
    status: "posted",
    merchant: cleanMerchant(withoutTitle(m[4])),
    description: m[0].trim(),
    transactionDate: date,
    sourceTimestamp: null,
    // "Transferred to" doesn't say whether it went by UPI, IMPS or NEFT.
    paymentMethod: "unknown",
    referenceId: null,
    uncertain: dateUncertainty(date, receivedAt),
  };
  return { kind: "transaction", alert };
}

function parseIciciAcctUpiDebit(flat: string, receivedAt: Date): ParseResult | null {
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
