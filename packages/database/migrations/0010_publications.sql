CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"build_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"build_version_id" text,
	"slug" text NOT NULL,
	"custom_domain" text,
	"domain_status" text DEFAULT 'none' NOT NULL,
	"domain_detail" text,
	"container_id" text,
	"status" text DEFAULT 'publishing' NOT NULL,
	"status_detail" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_build_version_id_build_versions_id_fk" FOREIGN KEY ("build_version_id") REFERENCES "public"."build_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publications_slug_idx" ON "publications" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_custom_domain_idx" ON "publications" USING btree ("custom_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_project_idx" ON "publications" USING btree ("build_project_id");
