// Deterministic merchant normalization used for rule matching and search.
// The original text is always kept separately; this is only a matching key.

const CHANNEL_PREFIX = /^(?:UPI|POS|ECOM|IMPS|NEFT|RTGS|ACH|NACH|MB|IB|BIL|BILLPAY|VPS|VIN)[\s/:-]+/;
const LEGAL_SUFFIX = /\s+(?:PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP|CO)\b.*$/;

export function normalizeMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.toUpperCase().trim();

  // Repeatedly strip channel prefixes such as "UPI/" or "POS ".
  for (let i = 0; i < 3 && CHANNEL_PREFIX.test(s); i++) s = s.replace(CHANNEL_PREFIX, "");

  // For a UPI ID (VPA) keep the handle before "@", e.g. "SWIGGY@ICICI" -> "SWIGGY".
  s = s.replace(/([A-Z0-9._-]+)@[A-Z0-9.]+/g, "$1");

  s = s
    .replace(/[^A-Z0-9&]+/g, " ")
    .split(" ")
    // Drop reference numbers and other long digit runs.
    .filter((token) => token && !/^\d{5,}$/.test(token) && !/^[A-Z]*\d{6,}[A-Z0-9]*$/.test(token))
    .join(" ")
    .trim();

  s = s.replace(LEGAL_SUFFIX, "").trim();
  return s.length > 0 ? s : null;
}

// Rule values are normalized the same way as the text they match.
export function normalizeRuleValue(matchType: "merchant_exact" | "merchant_contains" | "description_contains", value: string): string {
  if (matchType === "description_contains") return value.toUpperCase().replace(/\s+/g, " ").trim();
  return normalizeMerchant(value) ?? "";
}
