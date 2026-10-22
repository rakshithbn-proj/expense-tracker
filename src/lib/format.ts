// Display formatting shared by server and client components.
import type { CaptureMethod, PaymentMethod, TransactionStatus, TransactionType } from "./finance-types";
import { formatInr } from "./money";

export { formatInr };

// ₹950 · ₹12.5K · ₹3.4L · ₹1.2Cr (Indian units)
export function formatInrCompact(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  const r = Math.abs(paise) / 100;
  const fmt = (v: number, unit: string) => `${sign}₹${Number(v.toFixed(v < 10 ? 1 : 0))}${unit}`;
  if (r >= 1e7) return fmt(r / 1e7, "Cr");
  if (r >= 1e5) return fmt(r / 1e5, "L");
  if (r >= 1e3) return fmt(r / 1e3, "K");
  return `${sign}₹${Math.round(r)}`;
}

// Whole rupees for headline figures: ₹31,610
export function formatInrWhole(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

export function formatSignedInr(paise: number, direction: "debit" | "credit"): string {
  return `${direction === "debit" ? "−" : "+"}${formatInr(paise)}`;
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayShortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShortFmt = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export const formatDate = (date: string) => dayFmt.format(new Date(`${date}T00:00:00Z`));
export const formatDayShort = (date: string) => dayShortFmt.format(new Date(`${date}T00:00:00Z`));
export const formatDayHeading = (date: string) => weekdayFmt.format(new Date(`${date}T00:00:00Z`));
export const formatMonth = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`));
export const formatMonthShort = (month: string) => monthShortFmt.format(new Date(`${month}-01T00:00:00Z`));
export const formatDateTime = (iso: string) => timeFmt.format(new Date(iso));

export const TYPE_LABELS: Record<TransactionType, string> = {
  purchase: "Purchase",
  fee: "Fee or interest",
  income: "Income",
  refund: "Refund",
  reversal: "Reversal",
  internal_transfer: "Own-account transfer",
  card_settlement: "Card bill payment",
  investment: "Investment",
  cash_withdrawal: "Cash withdrawal",
  other: "Other",
};

export const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: "Pending",
  posted: "Completed",
  failed: "Failed",
  reversed: "Reversed",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  credit_card: "Credit card",
  debit_card: "Debit card",
  net_banking: "Net banking / IMPS / NEFT",
  auto_debit: "Auto-debit",
  cash: "Cash",
  wallet: "Wallet",
  other: "Other",
  unknown: "Unknown",
};

export const CAPTURE_LABELS: Record<CaptureMethod, string> = {
  auto_email: "Automatic: bank email",
  auto_sms: "Automatic: SMS",
  user_share: "Shared from iPhone",
  manual: "Entered manually",
  statement_import: "Statement import",
  sample: "Sample data",
};
