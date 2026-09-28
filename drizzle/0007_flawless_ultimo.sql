CREATE TABLE "model_usage_daily" (
	"day" text NOT NULL,
	"model_id" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_usage_daily_day_model_id_pk" PRIMARY KEY("day","model_id")
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "model_id" text DEFAULT 'gemini-3.5-flash' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "model_id" text;