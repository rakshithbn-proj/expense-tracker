CREATE TABLE "explain_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"slot_times" text DEFAULT '09:00,12:00,15:00,18:00,21:00' NOT NULL,
	"retry_minutes" integer DEFAULT 15 NOT NULL,
	"ask_from" timestamp with time zone DEFAULT now() NOT NULL,
	"prompt_lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explain_settings_retry" CHECK ("explain_settings"."retry_minutes" between 5 and 180)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "explained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "explain_settings" ADD CONSTRAINT "explain_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;