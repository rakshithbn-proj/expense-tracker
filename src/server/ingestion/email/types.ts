import type { AccountType, Direction, PaymentMethod, TransactionStatus, TransactionType } from "@/lib/finance-types";

// The decoded parts of an email that parsers work on. Nothing else is kept.
export type AlertEmail = {
  messageId: string;
  fromAddress: string; // lower-case address only
  subject: string;
  receivedAt: Date; // the email's own date
  text: string; // visible text (HTML converted)
  // Gmail's own record of whether the message is genuinely from the sender's domain.
  authentication: { verified: boolean; detail: string };
};

export type ParsedAlert = {
  parserId: string;
  institutionKey: string; // e.g. "hdfc"
  institutionName: string; // e.g. "HDFC Bank"
  accountType: AccountType;
  accountLast: string | null; // last digits as printed in the alert
  amountPaise: number;
  currency: string;
  direction: Direction;
  transactionType: TransactionType;
  status: Exclude<TransactionStatus, "reversed">;
  merchant: string | null;
  description: string; // the alert's key sentence, kept as the original description
  transactionDate: string; // YYYY-MM-DD, India time
  sourceTimestamp: Date | null; // only when the alert states a time
  paymentMethod: PaymentMethod;
  referenceId: string | null;
  // Fields the parser could not establish with confidence; these send the transaction to review.
  uncertain: string[];
};

export type ParseResult =
  | { kind: "transaction"; alert: ParsedAlert }
  | { kind: "not_transaction"; reason: string }
  | { kind: "unrecognized"; reason: string };

export type AlertParser = {
  id: string;
  institutionKey: string;
  institutionName: string;
  senders: string[]; // exact lower-case addresses
  description: string;
  parse: (email: AlertEmail) => ParseResult | null; // null: none of this parser's templates matched
};
