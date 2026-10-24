import { isOtpMessage, looksLikeTransaction } from "./parse-helpers";
import { hdfcParser } from "./parsers/hdfc";
import { hsbcParser } from "./parsers/hsbc";
import { iciciParser } from "./parsers/icici";
import { rblParser } from "./parsers/rbl";
import type { AlertEmail, AlertParser, ParseResult } from "./types";

// Parsers built from real alert samples (redacted fixtures in tests/fixtures/email).
// SBI and AMEX are out of scope by the user's choice; ICICI bank-account alerts are pending samples.
export const PARSERS: AlertParser[] = [hdfcParser, hsbcParser, iciciParser, rblParser];

export const KNOWN_SENDERS = new Set(PARSERS.flatMap((p) => p.senders));

export function parserForSender(fromAddress: string): AlertParser | null {
  const address = fromAddress.toLowerCase();
  return PARSERS.find((p) => p.senders.includes(address)) ?? null;
}

// Gmail search covering every sender we can parse.
export function gmailSenderQuery(): string {
  return `from:(${[...KNOWN_SENDERS].join(" OR ")})`;
}

// Routes an email to its institution's parser. An email from a known sender that looks like a
// transaction but matches no template is "unrecognized" and goes to the review queue, so a
// changed or new alert format is never silently dropped.
export function parseAlert(email: AlertEmail): ParseResult {
  const parser = parserForSender(email.fromAddress);
  if (!parser) return { kind: "not_transaction", reason: "sender is not a known alert sender" };
  if (isOtpMessage(email.text, email.subject)) return { kind: "not_transaction", reason: `${parser.id}: one-time password, not a completed payment` };
  try {
    const result = parser.parse(email);
    if (result) return result;
  } catch (err) {
    return { kind: "unrecognized", reason: `${parser.id}: ${err instanceof Error ? err.message : "parser error"}` };
  }
  return looksLikeTransaction(email.text, email.subject)
    ? { kind: "unrecognized", reason: `${parser.id}: looks like a transaction but matches no known template` }
    : { kind: "not_transaction", reason: `${parser.id}: not a transaction alert` };
}
