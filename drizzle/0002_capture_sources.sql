CREATE TYPE "public"."connection_status" AS ENUM('connected', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('created', 'matched_existing', 'possible_duplicate');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('pending', 'processing', 'parsed', 'not_transaction', 'unrecognized', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('gmail', 'shortcut', 'statement');--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_address" text NOT NULL,
	"refresh_token_encrypted" text,
	"scope" text NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"backfill_completed_at" timestamp with time zone,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_name" text NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_code" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid,
	"source_type" "source_type" NOT NULL,
	"source_identifier" text,
	"source_message_id" text,
	"statement_import_id" uuid,
	"statement_row_identifier" text,
	"raw_payload_hash" text,
	"payload" jsonb,
	"received_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"match_status" "match_status",
	"parser_id" text,
	"error_code" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"purge_payload_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_health" ADD CONSTRAINT "source_health_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_sources" ADD CONSTRAINT "transaction_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_sources" ADD CONSTRAINT "transaction_sources_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_health_user_source_uq" ON "source_health" USING btree ("user_id","source_type","source_name");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_sources_message_uq" ON "transaction_sources" USING btree ("user_id","source_type","source_message_id") WHERE "transaction_sources"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX "transaction_sources_queue_idx" ON "transaction_sources" USING btree ("parse_status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "transaction_sources_transaction_idx" ON "transaction_sources" USING btree ("transaction_id");