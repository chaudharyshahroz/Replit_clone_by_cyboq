ALTER TABLE "plans" ADD COLUMN "whop_plan_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "whop_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "whop_sync_error" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "billing_period_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "is_purchasable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Preserve what these deployments already did: before plans were editable,
-- every priced plan was on sale. Defaulting the column to false and stopping
-- there would take the shop offline on deploy.
UPDATE "plans" SET "is_purchasable" = true WHERE "price_monthly_usd"::numeric > 0;
