CREATE TABLE "connected_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_name" text,
	"bot_token" text NOT NULL,
	"installed_by_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_apps_provider_workspace_idx" ON "connected_apps" USING btree ("provider","workspace_id");