CREATE TABLE "data_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sql" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text DEFAULT 'postgres' NOT NULL,
	"name" text NOT NULL,
	"connection" text NOT NULL,
	"host" text NOT NULL,
	"database_name" text NOT NULL,
	"snapshot" jsonb DEFAULT '{"tables":[]}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_lookups" ADD CONSTRAINT "data_lookups_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_lookups" ADD CONSTRAINT "data_lookups_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_lookups_brand_key_idx" ON "data_lookups" USING btree ("brand_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_brand_idx" ON "data_sources" USING btree ("brand_id");