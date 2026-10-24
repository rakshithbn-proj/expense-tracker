// Verifies that an alert really comes from the bank's domain, using the authentication result
// Gmail itself recorded on arrival. Without this, anyone could email a fake "Rs. X debited"
// message with a forged From address and create transactions.
//
// Only the TOPMOST Authentication-Results header from mx.google.com is used: Gmail adds it when
// the message reaches this mailbox, and any such headers further down came with the message
// (possibly forged, or from an earlier hop).

export type SenderAuthentication = { verified: boolean; detail: string };

const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

// "hdfcbank.bank.in" aligns with "hdfcbank.bank.in" and with "mail.hdfcbank.bank.in".
const aligned = (signer: string, fromDomain: string) => signer === fromDomain || signer.endsWith(`.${fromDomain}`);

export function verifySender(fromAddress: string, authenticationResults: string[]): SenderAuthentication {
  const fromDomain = domainOf(fromAddress);
  if (!fromDomain) return { verified: false, detail: "no sender domain" };
  const gmail = authenticationResults.find((h) => /^\s*mx\.google\.com\s*;/i.test(h));
  if (!gmail) return { verified: false, detail: "no Gmail authentication result" };
  const flat = gmail.replace(/\s+/g, " ");

  // Direct delivery: a passing DKIM signature from the sender's own domain.
  for (const m of flat.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=@?([a-z0-9.-]+)/gi)) {
    if (aligned(m[1].toLowerCase(), fromDomain)) return { verified: true, detail: `DKIM pass for ${m[1].toLowerCase()}` };
  }
  // Auto-forwarded mail: Gmail carries the original verification forward as ARC.
  const arc = /\barc=pass \(([^)]*)\)/i.exec(flat);
  if (arc) {
    const dk = /\bdkim=pass\b/i.test(arc[1]) ? /\bdkdomain=([a-z0-9.-]+)/i.exec(arc[1])?.[1]?.toLowerCase() : undefined;
    if (dk && aligned(dk, fromDomain)) return { verified: true, detail: `ARC pass, original DKIM for ${dk}` };
  }
  return { verified: false, detail: `no passing signature from ${fromDomain}` };
}
