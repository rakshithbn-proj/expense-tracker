import { istDate } from "@/lib/dates";
import { parseAmountToPaise } from "@/lib/money";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

function build(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// "16-10-26", "11-10-2026", "22/10/26" (day first, as Indian banks write them)
export function parseDayFirst(s: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s.trim());
  return m ? build(fullYear(m[3]), Number(m[2]), Number(m[1])) : null;
}

// "08 Oct, 2026", "8 Oct 2026", "Oct 01, 2026"
export function parseMonthName(s: string): string | null {
  const t = s.trim().replace(/,/g, "");
  let m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(t);
  if (m) return MONTHS[m[2].toLowerCase()] ? build(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) : null;
  m = /^([A-Za-z]{3})[a-z]* (\d{1,2}) (\d{4})$/.exec(t);
  if (m) return MONTHS[m[1].toLowerCase()] ? build(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])) : null;
  return null;
}

// A wall-clock time printed in an Indian alert is India time (UTC+05:30).
export function istTimestamp(date: string, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return new Date(`${date}T${pad(Number(m[1]))}:${m[2]}:${m[3] ?? "00"}+05:30`);
}

export function amount(s: string): number {
  return parseAmountToPaise(s);
}

// Flags a stated date that is implausible against when the email arrived.
export function dateUncertainty(transactionDate: string, receivedAt: Date): string[] {
  const received = istDate(receivedAt);
  const diffDays = (Date.parse(`${received}T00:00:00Z`) - Date.parse(`${transactionDate}T00:00:00Z`)) / 86_400_000;
  return diffDays < -1 || diffDays > 10 ? ["transaction date far from email date"] : [];
}

export function cleanMerchant(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, 200) : null;
}

// Something from a bank sender that looks like money moved, even if no template matched.
export function looksLikeTransaction(text: string, subject: string): boolean {
  const s = `${subject} ${text}`;
  return /(?:₹|\bRs\.?|\bINR)\s?\d/i.test(s) && /\b(debited|credited|spent|transaction|txn|payment|paid|withdrawn|refund|reversed|purchase|swiped|used)\b/i.test(s);
}

// One-time passwords mean a payment was started, not completed; the bank sends a separate alert if
// it goes through. They're never recorded and nothing from them is kept.
export function isOtpMessage(text: string, subject: string): boolean {
  return /\b(OTP|one[- ]time password)\b/i.test(subject) || /\bone[- ]time password\b|\bOTP\s*(?:is\b|:)/i.test(text);
}
