CREATE TYPE "public"."notification_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"severity" "notification_severity" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheets_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_encrypted" text,
	"scope" text NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"spreadsheet_id" text,
	"spreadsheet_url" text,
	"synced_fingerprint" text,
	"synced_row_count" integer,
	"last_sync_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheets_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets_connections" ADD CONSTRAINT "sheets_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_key_uq" ON "notifications" USING btree ("user_id","dedup_key");--> statement-breakpoint
CREATE INDEX "notifications_user_updated_idx" ON "notifications" USING btree ("user_id","updated_at");