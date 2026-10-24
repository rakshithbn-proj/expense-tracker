// Masking for the short excerpts kept (7 days) when an alert or SMS can't be read automatically.
// Long digit runs (card, account and reference numbers) keep only their last 4 digits.
// Codes after "OTP", "password", "PIN" or "CVV" are blanked completely.
export function maskExcerpt(text: string): string {
  return text
    .replace(/\b(OTP|one[- ]time password|password|PIN|CVV)(\W{0,12}(?:is\W{1,3})?)[\d•*]{3,}/gi, "$1$2••••")
    .replace(/\d{5,}/g, (d) => "•".repeat(d.length - 4) + d.slice(-4))
    .slice(0, 1500);
}
