// Money is handled as integer paise everywhere in TypeScript. Never floats.

export class MoneyParseError extends Error {}

const MAX_PAISE = 999_999_999_999_99; // numeric(14,2)

// Parses amounts as they appear in Indian bank alerts and forms:
// "1,23,456.78", "₹ 500", "Rs. 1,000.5", "INR 250", "250/-".
export function parseAmountToPaise(input: string): number {
  const cleaned = input
    .trim()
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replace(/\/-$/, "")
    .replace(/,/g, "")
    .trim();

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new MoneyParseError(`Not a valid amount: "${input}"`);

  const rupees = match[1].replace(/^0+(?=\d)/, "");
  const paiseDigits = (match[2] ?? "").padEnd(2, "0");
  if (rupees.length > 12) throw new MoneyParseError(`Amount too large: "${input}"`);

  const paise = Number(rupees) * 100 + Number(paiseDigits);
  if (!Number.isSafeInteger(paise) || paise > MAX_PAISE) throw new MoneyParseError(`Amount too large: "${input}"`);
  return paise;
}

// Database numeric values arrive as strings like "1234.50" or "-12.00".
export function decimalToPaise(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new MoneyParseError(`Not a decimal: "${value}"`);
  const paise = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -paise : paise;
}

export function paiseToDecimal(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new MoneyParseError(`Not an integer paise value: ${paise}`);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export function formatInr(paise: number): string {
  return inr.format(paise / 100);
}
