import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ACCOUNT_TYPES,
  BUDGET_PERIODS,
  CAPTURE_METHODS,
  CATEGORY_SOURCES,
  DIRECTIONS,
  PAYMENT_METHODS,
  RULE_MATCH_TYPES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from "../../lib/finance-types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

// Only a SHA-256 hash of the session token is stored; the raw token lives in the cookie.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: inet("ip"),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_attempted_at_idx").on(t.attemptedAt)],
);

// Never store secrets, tokens or raw email content in metadata.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId)],
);

// ---------------------------------------------------------------------------
// Financial data (Milestone 2)
// ---------------------------------------------------------------------------

export const accountTypeEnum = pgEnum("account_type", ACCOUNT_TYPES);
export const directionEnum = pgEnum("direction", DIRECTIONS);
export const transactionTypeEnum = pgEnum("transaction_type", TRANSACTION_TYPES);
export const transactionStatusEnum = pgEnum("transaction_status", TRANSACTION_STATUSES);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);
export const captureMethodEnum = pgEnum("capture_method", CAPTURE_METHODS);
export const categorySourceEnum = pgEnum("category_source", CATEGORY_SOURCES);
export const ruleMatchTypeEnum = pgEnum("rule_match_type", RULE_MATCH_TYPES);
export const budgetPeriodEnum = pgEnum("budget_period", BUDGET_PERIODS);

// Money is numeric(14,2) in the database and integer paise in TypeScript. Never floats.
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    institutionName: text("institution_name").notNull(),
    accountName: text("account_name").notNull(),
    accountType: accountTypeEnum("account_type").notNull(),
    // Last digits only (e.g. "4321"). Full card or account numbers are never stored.
    maskedIdentifier: text("masked_identifier"),
    currency: text("currency").notNull().default("INR"),
    isActive: boolean("is_active").notNull().default(true),
    isSample: boolean("is_sample").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("financial_accounts_user_idx").on(t.userId),
    check("financial_accounts_masked_digits", sql`${t.maskedIdentifier} is null or ${t.maskedIdentifier} ~ '^[0-9]{2,6}$'`),
    check("financial_accounts_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Stable identifier for default categories, so logic still finds them after a rename.
    systemKey: text("system_key"),
    parentCategoryId: uuid("parent_category_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_user_name_uq").on(t.userId, t.name),
    uniqueIndex("categories_user_system_key_uq").on(t.userId, t.systemKey),
  ],
);

export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    matchType: ruleMatchTypeEnum("match_type").notNull(),
    // Stored normalized (see normalizeRuleValue) so matching is deterministic.
    matchValue: text("match_value").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    // Higher wins; ties go to the older rule.
    priority: integer("priority").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    isSample: boolean("is_sample").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("category_rules_user_idx").on(t.userId),
    uniqueIndex("category_rules_user_match_uq").on(t.userId, t.matchType, t.matchValue),
    check("category_rules_value_nonempty", sql`length(${t.matchValue}) > 0`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    financialAccountId: uuid("financial_account_id").references(() => financialAccounts.id, {
      onDelete: "restrict",
    }),
    // Calendar date of the event in India time; used for monthly attribution.
    transactionDate: date("transaction_date", { mode: "string" }).notNull(),
    // When the payment actually happened, if the source says. created_at is when we captured it.
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    merchantName: text("merchant_name"),
    merchantNormalized: text("merchant_normalized"),
    originalDescription: text("original_description"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    direction: directionEnum("direction").notNull(),
    transactionType: transactionTypeEnum("transaction_type").notNull(),
    transactionStatus: transactionStatusEnum("transaction_status").notNull().default("posted"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: categorySourceEnum("category_source"),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("unknown"),
    // Only set when a source actually says which app was used. Never inferred.
    paymentApp: text("payment_app"),
    referenceId: text("reference_id"),
    // Refunds and reversals point at the transaction they undo.
    parentTransactionId: uuid("parent_transaction_id").references((): AnyPgColumn => transactions.id, {
      onDelete: "restrict",
    }),
    // Both sides of an own-account transfer or card settlement share one group id.
    transferGroupId: uuid("transfer_group_id"),
    deduplicationKey: text("deduplication_key"),
    captureMethod: captureMethodEnum("capture_method").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: text("review_reason"),
    notes: text("notes"),
    // Why the user made this payment, in their own words (asked by the "explain" prompts).
    reason: text("reason"),
    // Set once the user has answered for this payment (category confirmed, reason optional).
    explainedAt: timestamp("explained_at", { withTimezone: true }),
    isSample: boolean("is_sample").notNull().default(false),
    // Voided entries stay in the database for the audit trail and are excluded everywhere.
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("transactions_user_date_idx").on(t.userId, t.transactionDate),
    index("transactions_user_category_idx").on(t.userId, t.categoryId),
    index("transactions_user_account_idx").on(t.userId, t.financialAccountId),
    index("transactions_parent_idx").on(t.parentTransactionId),
    index("transactions_transfer_group_idx").on(t.transferGroupId),
    uniqueIndex("transactions_user_dedup_uq")
      .on(t.userId, t.deduplicationKey)
      .where(sql`${t.deduplicationKey} is not null`),
    check("transactions_amount_positive", sql`${t.amount} > 0`),
    check("transactions_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("transactions_not_own_parent", sql`${t.parentTransactionId} is null or ${t.parentTransactionId} <> ${t.id}`),
    check(
      "transactions_type_direction",
      sql`(${t.transactionType} in ('purchase','fee','investment','cash_withdrawal') and ${t.direction} = 'debit')
        or (${t.transactionType} in ('income','refund','reversal') and ${t.direction} = 'credit')
        or ${t.transactionType} in ('internal_transfer','card_settlement','other')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Capture sources and ingestion (Milestone 4)
// ---------------------------------------------------------------------------

export const sourceTypeEnum = pgEnum("source_type", ["gmail", "shortcut", "statement"]);
export const parseStatusEnum = pgEnum("parse_status", ["pending", "processing", "parsed", "not_transaction", "unrecognized", "failed"]);
export const matchStatusEnum = pgEnum("match_status", ["created", "matched_existing", "possible_duplicate"]);
export const connectionStatusEnum = pgEnum("connection_status", ["connected", "needs_reauth", "disconnected"]);

// One row per incoming source event (an email, a Shortcut submission, a statement row). It is
// written before any processing, so nothing is lost if the worker stops, and it doubles as the
// work queue (claimed with FOR UPDATE SKIP LOCKED) and as permanent provenance.
// `payload` holds only what processing needs and is cleared afterwards (see purge_payload_after).
export const transactionSources = pgTable(
  "transaction_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    // Which account or device it came from, e.g. the Gmail address.
    sourceIdentifier: text("source_identifier"),
    sourceMessageId: text("source_message_id"),
    statementImportId: uuid("statement_import_id"),
    statementRowIdentifier: text("statement_row_identifier"),
    rawPayloadHash: text("raw_payload_hash"),
    payload: jsonb("payload"),
    // When the source received it (e.g. Gmail's arrival time), for latency measurement.
    receivedAt: timestamp("received_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    parseStatus: parseStatusEnum("parse_status").notNull().default("pending"),
    matchStatus: matchStatusEnum("match_status"),
    parserId: text("parser_id"),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    purgePayloadAfter: timestamp("purge_payload_after", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("transaction_sources_message_uq")
      .on(t.userId, t.sourceType, t.sourceMessageId)
      .where(sql`${t.sourceMessageId} is not null`),
    index("transaction_sources_queue_idx").on(t.parseStatus, t.nextAttemptAt),
    index("transaction_sources_transaction_idx").on(t.transactionId),
  ],
);

export const gmailConnections = pgTable("gmail_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  emailAddress: text("email_address").notNull(),
  // AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY. Never logged or sent to the browser.
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  scope: text("scope").notNull(),
  status: connectionStatusEnum("status").notNull().default("connected"),
  backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
  lastSyncStartedAt: timestamp("last_sync_started_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
});

// Revocable keys for iPhone Shortcuts (Milestone 5). Only a SHA-256 hash is stored; the key is
// shown once when created. A key can only submit transactions to the ingestion endpoint.
export const deviceKeys = pgTable(
  "device_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    // First characters of the key, shown in the UI so the user can tell keys apart.
    keyPrefix: text("key_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_keys_user_idx").on(t.userId)],
);

export const sourceHealth = pgTable(
  "source_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    status: text("status").notNull().default("not_configured"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("source_health_user_source_uq").on(t.userId, t.sourceType, t.sourceName)],
);

// A budget row applies from its period_start month onward, until a later row for the same
// category replaces it. category_id null means the overall monthly budget.
export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    periodType: budgetPeriodEnum("period_type").notNull().default("monthly"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    limitAmount: money("limit_amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    warnAtPercent: integer("warn_at_percent").notNull().default(80),
    ...timestamps,
  },
  (t) => [
    unique("budgets_user_category_period_uq").on(t.userId, t.categoryId, t.periodStart).nullsNotDistinct(),
    check("budgets_limit_positive", sql`${t.limitAmount} > 0`),
    check("budgets_period_start_first_of_month", sql`extract(day from ${t.periodStart}) = 1`),
    check("budgets_warn_percent", sql`${t.warnAtPercent} between 1 and 100`),
  ],
);

// ---------------------------------------------------------------------------
// Notifications and Google Sheets sync (Milestone 7)
// ---------------------------------------------------------------------------

export const notificationSeverityEnum = pgEnum("notification_severity", ["info", "warning", "critical"]);

// In-app notifications, generated by the worker (src/server/notifications). One row per
// dedup_key: a recurring condition (e.g. Gmail needs reconnecting) reopens its row instead of
// piling up duplicates. Bodies never contain secrets or raw email text.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    dedupKey: text("dedup_key").notNull(),
    severity: notificationSeverityEnum("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Set when the condition behind it cleared (or the user dismissed it).
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("notifications_user_key_uq").on(t.userId, t.dedupKey), index("notifications_user_updated_idx").on(t.userId, t.updatedAt)],
);

// One Google Sheets destination per user. Uses its own OAuth grant (drive.file: access only to
// the spreadsheet this app creates), separate from the read-only Gmail grant.
export const sheetsConnections = pgTable("sheets_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY. Never logged or sent to the browser.
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  scope: text("scope").notNull(),
  status: connectionStatusEnum("status").notNull().default("connected"),
  // The Google account that owns the spreadsheet, as confirmed by Google at connect time.
  emailAddress: text("email_address"),
  spreadsheetId: text("spreadsheet_id"),
  spreadsheetUrl: text("spreadsheet_url"),
  // Fingerprint of the data last written, so unchanged data isn't rewritten every cycle.
  syncedFingerprint: text("synced_fingerprint"),
  syncedRowCount: integer("synced_row_count"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  ...timestamps,
});

// When the iPhone "explain" Shortcut should ask about new payments (Milestone 7 follow-up).
// Payments become due at the next slot time after they were captured; once asked, nothing is
// asked again until prompt_lease_until (the retry interval), so a skipped batch returns later.
export const explainSettings = pgTable("explain_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  // India-time slots, "HH:MM" comma-separated.
  slotTimes: text("slot_times").notNull().default("09:00,12:00,15:00,18:00,21:00"),
  retryMinutes: integer("retry_minutes").notNull().default(15),
  // Only payments captured from this moment are asked about, so the history isn't one huge batch.
  askFrom: timestamp("ask_from", { withTimezone: true }).notNull().defaultNow(),
  promptLeaseUntil: timestamp("prompt_lease_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("explain_settings_retry", sql`${t.retryMinutes} between 5 and 180`)]);
