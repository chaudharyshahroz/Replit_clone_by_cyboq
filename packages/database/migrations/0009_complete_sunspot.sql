CREATE TABLE "build_events" (
	"id" text PRIMARY KEY NOT NULL,
	"build_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text DEFAULT 'stage' NOT NULL,
	"message" text NOT NULL,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_events" ADD CONSTRAINT "build_events_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_events" ADD CONSTRAINT "build_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "build_events_project_idx" ON "build_events" USING btree ("build_project_id","created_at");