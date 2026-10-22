CREATE TYPE "public"."account_type" AS ENUM('bank_account', 'credit_card', 'wallet', 'cash', 'investment', 'loan');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('monthly');--> statement-breakpoint
CREATE TYPE "public"."capture_method" AS ENUM('auto_email', 'auto_sms', 'user_share', 'manual', 'statement_import', 'sample');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('rule', 'user', 'type_default');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('upi', 'credit_card', 'debit_card', 'net_banking', 'auto_debit', 'cash', 'wallet', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."rule_match_type" AS ENUM('merchant_exact', 'merchant_contains', 'description_contains');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'posted', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('purchase', 'fee', 'income', 'refund', 'reversal', 'internal_transfer', 'card_settlement', 'investment', 'cash_withdrawal', 'other');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"period_type" "budget_period" DEFAULT 'monthly' NOT NULL,
	"period_start" date NOT NULL,
	"limit_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"warn_at_percent" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_category_period_uq" UNIQUE NULLS NOT DISTINCT("user_id","category_id","period_start"),
	CONSTRAINT "budgets_limit_positive" CHECK ("budgets"."limit_amount" > 0),
	CONSTRAINT "budgets_period_start_first_of_month" CHECK (extract(day from "budgets"."period_start") = 1),
	CONSTRAINT "budgets_warn_percent" CHECK ("budgets"."warn_at_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_key" text,
	"parent_category_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_type" "rule_match_type" NOT NULL,
	"match_value" text NOT NULL,
	"category_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_value_nonempty" CHECK (length("category_rules"."match_value") > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"institution_name" text NOT NULL,
	"account_name" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"masked_identifier" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_masked_digits" CHECK ("financial_accounts"."masked_identifier" is null or "financial_accounts"."masked_identifier" ~ '^[0-9]{2,6}$'),
	CONSTRAINT "financial_accounts_currency" CHECK ("financial_accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"financial_account_id" uuid,
	"transaction_date" date NOT NULL,
	"source_timestamp" timestamp with time zone,
	"merchant_name" text,
	"merchant_normalized" text,
	"original_description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"direction" "direction" NOT NULL,
	"transaction_type" "transaction_type" NOT NULL,
	"transaction_status" "transaction_status" DEFAULT 'posted' NOT NULL,
	"category_id" uuid,
	"category_source" "category_source",
	"payment_method" "payment_method" DEFAULT 'unknown' NOT NULL,
	"payment_app" text,
	"reference_id" text,
	"parent_transaction_id" uuid,
	"transfer_group_id" uuid,
	"deduplication_key" text,
	"capture_method" "capture_method" NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"notes" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0),
	CONSTRAINT "transactions_currency" CHECK ("transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_not_own_parent" CHECK ("transactions"."parent_transaction_id" is null or "transactions"."parent_transaction_id" <> "transactions"."id"),
	CONSTRAINT "transactions_type_direction" CHECK (("transactions"."transaction_type" in ('purchase','fee','investment','cash_withdrawal') and "transactions"."direction" = 'debit')
        or ("transactions"."transaction_type" in ('income','refund','reversal') and "transactions"."direction" = 'credit')
        or "transactions"."transaction_type" in ('internal_transfer','card_settlement','other'))
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_category_id_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_financial_account_id_financial_accounts_id_fk" FOREIGN KEY ("financial_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_transaction_id_transactions_id_fk" FOREIGN KEY ("parent_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_uq" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_system_key_uq" ON "categories" USING btree ("user_id","system_key");--> statement-breakpoint
CREATE INDEX "category_rules_user_idx" ON "category_rules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_user_match_uq" ON "category_rules" USING btree ("user_id","match_type","match_value");--> statement-breakpoint
CREATE INDEX "financial_accounts_user_idx" ON "financial_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_account_idx" ON "transactions" USING btree ("user_id","financial_account_id");--> statement-breakpoint
CREATE INDEX "transactions_parent_idx" ON "transactions" USING btree ("parent_transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group_idx" ON "transactions" USING btree ("transfer_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_dedup_uq" ON "transactions" USING btree ("user_id","deduplication_key") WHERE "transactions"."deduplication_key" is not null;