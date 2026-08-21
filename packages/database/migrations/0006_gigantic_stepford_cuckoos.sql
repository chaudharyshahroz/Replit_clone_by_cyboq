CREATE TABLE "checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_key" text NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"whop_plan_id" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_method_label" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "whop_membership_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "manage_url" text;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_sessions_workspace_idx" ON "checkout_sessions" USING btree ("workspace_id","created_at");