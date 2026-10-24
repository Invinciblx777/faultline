CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "execution_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"execution_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"offset_ms" integer NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"resource_type" text,
	"method" text,
	"status_code" integer,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"conditions" jsonb NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text,
	"http_status" integer,
	"page_title" text,
	"navigation_error" text,
	"browser_name" text,
	"browser_version" text,
	"user_agent" text,
	"viewport" jsonb,
	"summary" jsonb,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"target_url" text NOT NULL,
	"scenario_kind" text NOT NULL,
	"scenario_config" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text,
	"job_id" text,
	"error_code" text,
	"error_message" text,
	"environment" jsonb,
	"worker_id" text,
	"cancel_requested_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "worker_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"hostname" text NOT NULL,
	"browser_name" text,
	"browser_version" text,
	"playwright_version" text,
	"deployment_mode" text NOT NULL,
	"concurrency" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_execution_id_scan_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_scan_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scan_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_executions" ADD CONSTRAINT "scan_executions_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_storage_key_key" ON "artifacts" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "artifacts_execution_idx" ON "artifacts" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_events_execution_seq_key" ON "execution_events" USING btree ("execution_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_sessions_token_hash_key" ON "operator_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_sessions_operator_idx" ON "operator_sessions" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_username_key" ON "operators" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "projects_created_at_idx" ON "projects" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_executions_scan_role_key" ON "scan_executions" USING btree ("scan_id","role");--> statement-breakpoint
CREATE INDEX "scans_project_created_idx" ON "scans" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");