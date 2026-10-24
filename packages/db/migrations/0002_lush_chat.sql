CREATE TABLE "repair_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repair_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repair_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"external_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operator_id" uuid,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "repair_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"base_branch" text NOT NULL,
	"base_sha" text,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"status_detail" text,
	"evidence" jsonb NOT NULL,
	"evidence_sha256" text NOT NULL,
	"prompt" text NOT NULL,
	"prompt_sha256" text NOT NULL,
	"regression_test_id" uuid NOT NULL,
	"regression_test_sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_by_username" text,
	"approved_at" timestamp with time zone,
	"approval_statement" text,
	"cancelled_at" timestamp with time zone,
	"devin_tag" text NOT NULL,
	"worker_id" text,
	"submit_started_at" timestamp with time zone,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"devin_session_id" text,
	"devin_session_url" text,
	"devin_status" text,
	"devin_status_detail" text,
	"devin_created_at" timestamp with time zone,
	"devin_updated_at" timestamp with time zone,
	"devin_acus_consumed" integer,
	"messages_cursor" text,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"sync_failures" integer DEFAULT 0 NOT NULL,
	"pr_url" text,
	"pr_number" integer,
	"pr_state" text,
	"pr_merged" boolean,
	"pr_draft" boolean,
	"pr_title" text,
	"pr_base_ref" text,
	"pr_head_ref" text,
	"pr_head_sha" text,
	"pr_created_at" timestamp with time zone,
	"pr_updated_at" timestamp with time zone,
	"pr_checked_at" timestamp with time zone,
	"pr_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_verification_id" uuid,
	"verdict" text,
	"verdict_rationale" jsonb,
	"verified_sha" text,
	"verdict_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"base_branch" text NOT NULL,
	"app_dir" text,
	"recipe" jsonb NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"github_status" text DEFAULT 'not_checked' NOT NULL,
	"github_detail" text,
	"base_sha" text,
	"devin_status" text DEFAULT 'not_checked' NOT NULL,
	"devin_detail" text,
	"devin_repo_name" text
);
--> statement-breakpoint
CREATE TABLE "verification_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"stage" text NOT NULL,
	"revision" text NOT NULL,
	"sha" text NOT NULL,
	"target_origin" text NOT NULL,
	"method" text NOT NULL,
	"purpose" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"fault_applied" boolean NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"output" text,
	"steps" jsonb,
	"errors" jsonb,
	"fault_applications" integer,
	"screenshot_key" text,
	"screenshot_sha256" text,
	"screenshot_bytes" integer,
	"screenshot_width" integer,
	"screenshot_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text,
	"requested_by" uuid,
	"original_sha" text NOT NULL,
	"candidate_sha" text NOT NULL,
	"pr_number" integer NOT NULL,
	"regression_test_sha256" text NOT NULL,
	"builds" jsonb,
	"verdict" text,
	"rationale" jsonb,
	"error_message" text,
	"worker_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_repair_id_repair_requests_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_events" ADD CONSTRAINT "repair_events_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_repository_id_source_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."source_repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_regression_test_id_regression_tests_id_fk" FOREIGN KEY ("regression_test_id") REFERENCES "public"."regression_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_approved_by_operators_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_repositories" ADD CONSTRAINT "source_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_repositories" ADD CONSTRAINT "source_repositories_linked_by_operators_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_repair_id_repair_requests_id_fk" FOREIGN KEY ("repair_id") REFERENCES "public"."repair_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_requested_by_operators_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_events_repair_idx" ON "repair_events" USING btree ("repair_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_events_external_key" ON "repair_events" USING btree ("repair_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_requests_open_experiment_key" ON "repair_requests" USING btree ("experiment_id") WHERE "repair_requests"."status" not in ('cancelled', 'devin_failed');--> statement-breakpoint
CREATE UNIQUE INDEX "repair_requests_devin_tag_key" ON "repair_requests" USING btree ("devin_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_requests_devin_session_key" ON "repair_requests" USING btree ("devin_session_id");--> statement-breakpoint
CREATE INDEX "repair_requests_status_idx" ON "repair_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "repair_requests_project_idx" ON "repair_requests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_repositories_project_key" ON "source_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_checks_run_ordinal_key" ON "verification_checks" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "verification_runs_repair_idx" ON "verification_runs" USING btree ("repair_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_runs_status_idx" ON "verification_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_runs_active_key" ON "verification_runs" USING btree ("repair_id") WHERE "verification_runs"."status" in ('queued', 'running');