ALTER TABLE "budgets" DROP CONSTRAINT "budgets_user_category_period_uq";--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_category_reason_period_uq" UNIQUE NULLS NOT DISTINCT("user_id","category_id","reason","period_start");