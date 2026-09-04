CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "account_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid,
	"author_name" text NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"brand_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_minute" integer DEFAULT 540 NOT NULL,
	"closes_minute" integer DEFAULT 1080 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "business_hours_brand_id_weekday_pk" PRIMARY KEY("brand_id","weekday")
);
--> statement-breakpoint
CREATE TABLE "customer_consents" (
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"detail" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_consents_customer_id_kind_pk" PRIMARY KEY("customer_id","kind")
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_membership_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"label" text NOT NULL,
	"status" text,
	"amount_pence" integer,
	"source_system" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"note" text,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"body" text NOT NULL,
	"author_name" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'synced' NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "model_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warn' NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"axis_key" text,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_by_name" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mrr_snapshots" (
	"org_id" uuid NOT NULL,
	"month" timestamp with time zone NOT NULL,
	"mrr_pence" integer DEFAULT 0 NOT NULL,
	"seat_count" integer DEFAULT 0 NOT NULL,
	"plan" "plan" NOT NULL,
	CONSTRAINT "mrr_snapshots_org_id_month_pk" PRIMARY KEY("org_id","month")
);
--> statement-breakpoint
CREATE TABLE "platform_dependencies" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"provider" text,
	"state" text DEFAULT 'healthy' NOT NULL,
	"note" text,
	"latency_ms" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 365 NOT NULL,
	"redact_pii" boolean DEFAULT true NOT NULL,
	"train_on_transcripts" boolean DEFAULT false NOT NULL,
	"record_calls" boolean DEFAULT true NOT NULL,
	"data_region" text DEFAULT 'eu-west-2' NOT NULL,
	"dpo_email" text,
	"allow_support_access" boolean DEFAULT true NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"membership_id" uuid,
	"surface" text NOT NULL,
	"name" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"org_id" uuid NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"contained" integer DEFAULT 0 NOT NULL,
	"handoffs" integer DEFAULT 0 NOT NULL,
	"ai_minutes" integer DEFAULT 0 NOT NULL,
	"human_minutes" integer DEFAULT 0 NOT NULL,
	"cost_pence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_org_id_day_pk" PRIMARY KEY("org_id","day")
);
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "clerk_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "timezone" text DEFAULT 'Europe/London' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "after_hours_mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_by_name" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "stage" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "rollout_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "membership_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "invited_by_name" text;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD COLUMN "assigned_to_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_notes" ADD CONSTRAINT "account_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_notes" ADD CONSTRAINT "account_notes_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_records" ADD CONSTRAINT "customer_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_alerts" ADD CONSTRAINT "model_alerts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_alerts" ADD CONSTRAINT "model_alerts_axis_key_scoring_axes_key_fk" FOREIGN KEY ("axis_key") REFERENCES "public"."scoring_axes"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrr_snapshots" ADD CONSTRAINT "mrr_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_notes_org_idx" ON "account_notes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_records_customer_idx" ON "customer_records" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revisions_doc_rev_idx" ON "document_revisions" USING btree ("document_id","revision");--> statement-breakpoint
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" USING btree ("incident_id","at");--> statement-breakpoint
CREATE INDEX "knowledge_sources_brand_idx" ON "knowledge_sources" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "model_alerts_brand_idx" ON "model_alerts" USING btree ("brand_id","status","created_at");--> statement-breakpoint
CREATE INDEX "saved_views_scope_idx" ON "saved_views" USING btree ("org_id","surface","ordinal");--> statement-breakpoint
ALTER TABLE "quality_flags" ADD CONSTRAINT "quality_flags_assigned_to_staff_id_staff_id_fk" FOREIGN KEY ("assigned_to_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_email_idx" ON "memberships" USING btree ("org_id","email");