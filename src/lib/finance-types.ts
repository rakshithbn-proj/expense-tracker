// Shared by the database schema, server logic and UI, so it has no server-only import.

export const ACCOUNT_TYPES = ["bank_account", "credit_card", "wallet", "cash", "investment", "loan"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DIRECTIONS = ["debit", "credit"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// The type is the single source of truth for accounting treatment (ADR-0006).
// - purchase: any spending, including paying another person or business by UPI/IMPS.
// - internal_transfer: money moving between two of the user's OWN accounts only.
// - card_settlement: paying a credit card bill (bank debit and/or card credit side).
export const TRANSACTION_TYPES = [
  "purchase",
  "fee",
  "income",
  "refund",
  "reversal",
  "internal_transfer",
  "card_settlement",
  "investment",
  "cash_withdrawal",
  "other",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["pending", "posted", "failed", "reversed"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_METHODS = [
  "upi",
  "credit_card",
  "debit_card",
  "net_banking",
  "auto_debit",
  "cash",
  "wallet",
  "other",
  "unknown",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Only the auto_* methods count toward automatic capture coverage (ADR-0003).
export const CAPTURE_METHODS = ["auto_email", "auto_sms", "user_share", "manual", "statement_import", "sample"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const CATEGORY_SOURCES = ["rule", "user", "type_default"] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export const RULE_MATCH_TYPES = ["merchant_exact", "merchant_contains", "description_contains"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const BUDGET_PERIODS = ["monthly"] as const;

// Which directions each type may have. Enforced in code and by a database check.
export const ALLOWED_DIRECTIONS: Record<TransactionType, readonly Direction[]> = {
  purchase: ["debit"],
  fee: ["debit"],
  investment: ["debit"],
  cash_withdrawal: ["debit"],
  income: ["credit"],
  refund: ["credit"],
  reversal: ["credit"],
  internal_transfer: ["debit", "credit"],
  card_settlement: ["debit", "credit"],
  other: ["debit", "credit"],
};

export const DEFAULT_CATEGORIES = [
  { key: "food_dining", name: "Food & Dining" },
  { key: "groceries", name: "Groceries" },
  { key: "transport_travel", name: "Transport & Travel" },
  { key: "shopping", name: "Shopping" },
  { key: "bills_utilities", name: "Bills & Utilities" },
  { key: "entertainment", name: "Entertainment" },
  { key: "health", name: "Health" },
  { key: "subscriptions", name: "Subscriptions" },
  { key: "rent_housing", name: "Rent & Housing" },
  { key: "emis_loan_interest", name: "EMIs & Loan Interest" },
  { key: "investments", name: "Investments" },
  { key: "family_gifts", name: "Family & Gifts" },
  { key: "personal_care", name: "Personal Care" },
  { key: "uncategorized", name: "Other / Uncategorized" },
] as const;
export type DefaultCategoryKey = (typeof DEFAULT_CATEGORIES)[number]["key"];
