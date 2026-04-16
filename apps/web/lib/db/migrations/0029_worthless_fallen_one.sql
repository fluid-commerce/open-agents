CREATE TABLE "github_installation_repositories" (
	"user_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"description" text,
	"private" boolean NOT NULL,
	"repo_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_repositories_user_id_installation_id_name_pk" PRIMARY KEY("user_id","installation_id","name")
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "repo_cache_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "repo_cache_stale_at" timestamp;--> statement-breakpoint
ALTER TABLE "github_installation_repositories" ADD CONSTRAINT "github_installation_repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installation_repos_user_installation_idx" ON "github_installation_repositories" USING btree ("user_id","installation_id");