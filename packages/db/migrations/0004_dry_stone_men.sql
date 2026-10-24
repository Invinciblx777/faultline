ALTER TABLE "repair_requests" ALTER COLUMN "devin_acus_consumed" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "pr_agent_limitations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "verdict_comment_id" bigint;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "verdict_comment_url" text;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "verdict_comment_run_id" uuid;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "verdict_comment_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD COLUMN "verdict_comment_claimed_at" timestamp with time zone;