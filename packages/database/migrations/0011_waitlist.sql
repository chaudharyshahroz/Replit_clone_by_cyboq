CREATE TABLE "waitlist_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"source" text,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_idx" ON "waitlist_signups" USING btree ("email");--> statement-breakpoint
CREATE INDEX "waitlist_signups_created_idx" ON "waitlist_signups" USING btree ("created_at");
