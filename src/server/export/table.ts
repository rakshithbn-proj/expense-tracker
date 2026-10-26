import { CAPTURE_LABELS, METHOD_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/lib/format";
import { paiseToDecimal } from "@/lib/money";
import type { TransactionDto } from "@/server/finance/transactions-service";

// One typed cell. Numbers are carried as exact decimal text (never floats) and written as real
// numbers by each format; text is always written as text, so it can never become a formula.
export type Cell = { t: "s"; v: string } | { t: "n"; v: string } | null;
export type Table = { headers: string[]; rows: Cell[][] };

const text = (v: string | null | undefined): Cell => (v ? { t: "s", v } : null);
const num = (v: string): Cell => ({ t: "n", v });

const istStamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
// "2026-10-22 17:30" in India time.
export function istTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const p = Object.fromEntries(istStamp.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const TRANSACTION_HEADERS = [
  "Transaction ID",
  "Date",
  "Merchant",
  "Description",
  "Amount (INR)",
  "Direction",
  "Signed amount (INR)",
  "Type",
  "Status",
  "Category",
  "Account or card",
  "Payment method",
  "Payment app",
  "Reference",
  "Captured by",
  "Needs review",
  "Notes",
  "Captured at (IST)",
  "Voided",
  "Sample data",
];

export function transactionTable(
  items: TransactionDto[],
  names: { categoryName: Map<string, string>; accountName: Map<string, string> },
): Table {
  const rows = items.map((t): Cell[] => {
    const amount = paiseToDecimal(t.amountPaise);
    return [
      text(t.id),
      text(t.transactionDate),
      text(t.merchantName),
      text(t.originalDescription),
      num(amount),
      text(t.direction === "debit" ? "Debit" : "Credit"),
      num(t.direction === "debit" ? `-${amount}` : amount),
      text(TYPE_LABELS[t.transactionType]),
      text(STATUS_LABELS[t.transactionStatus]),
      text(t.categoryId ? (names.categoryName.get(t.categoryId) ?? null) : "Uncategorized"),
      text(t.financialAccountId ? (names.accountName.get(t.financialAccountId) ?? null) : null),
      text(METHOD_LABELS[t.paymentMethod]),
      text(t.paymentApp),
      text(t.referenceId),
      text(CAPTURE_LABELS[t.captureMethod]),
      text(t.needsReview ? "Yes" : "No"),
      text(t.notes),
      text(istTimestamp(t.capturedAt)),
      text(t.voidedAt ? "Yes" : "No"),
      text(t.isSample ? "Yes" : "No"),
    ];
  });
  return { headers: TRANSACTION_HEADERS, rows };
}
