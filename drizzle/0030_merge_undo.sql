ALTER TABLE "customer_merges" ADD COLUMN "moved" jsonb;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD COLUMN "undone_by" text;