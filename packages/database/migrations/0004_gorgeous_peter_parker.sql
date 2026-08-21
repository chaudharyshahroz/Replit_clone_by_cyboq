ALTER TABLE "plans" ADD COLUMN "whop_plan_id_yearly" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "yearly_enabled" boolean DEFAULT false NOT NULL;