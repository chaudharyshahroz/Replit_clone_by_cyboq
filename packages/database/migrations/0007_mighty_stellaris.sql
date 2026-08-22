CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text,
	"provider" text DEFAULT 'whop' NOT NULL,
	"event_type" text,
	"outcome" text NOT NULL,
	"detail" text,
	"workspace_id" text,
	"payload_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_external_idx" ON "webhook_deliveries" USING btree ("external_id");