CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"scope" text NOT NULL,
	"party" text NOT NULL,
	"origin" text NOT NULL,
	"method" text,
	"path_pattern" text,
	"resource_types" jsonb NOT NULL,
	"matcher" jsonb NOT NULL,
	"request_count" integer NOT NULL,
	"failed_count" integer NOT NULL,
	"statuses" jsonb NOT NULL,
	"median_duration_ms" integer,
	"sample_urls" jsonb NOT NULL,
	"eligible_faults" jsonb NOT NULL,
	"ineligible_reason" text,
	"requested_during_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"dependency_id" uuid,
	"dependency_key" text,
	"dependency_label" text,
	"fault" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verdict" text,
	"reproducibility" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usable_assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_request_count" integer DEFAULT 0 NOT NULL,
	"new_failed_request_count" integer DEFAULT 0 NOT NULL,
	"visual" jsonb,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "network_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"execution_id" uuid NOT NULL,
	"request_id" integer NOT NULL,
	"url" text NOT NULL,
	"method" text NOT NULL,
	"resource_type" text NOT NULL,
	"origin" text,
	"party" text,
	"is_main_document" boolean DEFAULT false NOT NULL,
	"status" integer,
	"outcome" text NOT NULL,
	"failure_text" text,
	"injected" text,
	"dependency_key" text,
	"step_index" integer,
	"started_offset_ms" integer NOT NULL,
	"duration_ms" integer,
	"from_service_worker" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regression_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL,
	"sha256" text NOT NULL,
	"command" text NOT NULL,
	"validation_status" text DEFAULT 'not_run' NOT NULL,
	"validation_summary" text,
	"validation_output" text,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" text NOT NULL,
	"description" text NOT NULL,
	"is_assertion" boolean NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"offset_ms" integer,
	"duration_ms" integer,
	"error" text,
	"detail" jsonb
);
--> statement-breakpoint
DROP INDEX "scan_executions_scan_role_key";--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "step_index" integer;--> statement-breakpoint
ALTER TABLE "scan_executions" ADD COLUMN "ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_executions" ADD COLUMN "experiment_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_executions" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "journey_id" uuid;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "journey_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_dependency_id_dependencies_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "public"."dependencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_requests" ADD CONSTRAINT "network_requests_execution_id_scan_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regression_tests" ADD CONSTRAINT "regression_tests_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regression_tests" ADD CONSTRAINT "regression_tests_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_execution_id_scan_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dependencies_scan_key_key" ON "dependencies" USING btree ("scan_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_scan_ordinal_key" ON "experiments" USING btree ("scan_id","ordinal");--> statement-breakpoint
CREATE INDEX "experiments_verdict_idx" ON "experiments" USING btree ("verdict");--> statement-breakpoint
CREATE UNIQUE INDEX "journeys_lineage_version_key" ON "journeys" USING btree ("lineage_id","version");--> statement-breakpoint
CREATE INDEX "journeys_project_idx" ON "journeys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "network_requests_execution_request_key" ON "network_requests" USING btree ("execution_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regression_tests_experiment_key" ON "regression_tests" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_results_execution_phase_step_key" ON "step_results" USING btree ("execution_id","phase","step_index");--> statement-breakpoint
ALTER TABLE "scan_executions" ADD CONSTRAINT "scan_executions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_executions_scan_role_ordinal_key" ON "scan_executions" USING btree ("scan_id","role","ordinal");--> statement-breakpoint
CREATE INDEX "scan_executions_experiment_idx" ON "scan_executions" USING btree ("experiment_id");