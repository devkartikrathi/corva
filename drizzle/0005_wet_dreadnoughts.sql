ALTER TABLE "conversations" ADD COLUMN "cost_pence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "cost_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;