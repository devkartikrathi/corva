CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'staff', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_version_status" AS ENUM('draft', 'live', 'retired');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('phone', 'whatsapp', 'web_chat', 'email', 'sms', 'survey');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('live', 'waiting_human', 'resolved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'published', 'archived', 'missing');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('waiting', 'accepted', 'resolved', 'reassigned');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('ai_resolved', 'human_resolved', 'escalated', 'no_document', 'no_follow_up', 'detractor');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('trial', 'studio', 'operator', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'manager', 'agent', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."speaker" AS ENUM('customer', 'ai', 'human', 'system');--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"persona" text NOT NULL,
	"tone" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent_version_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"author_name" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"brand_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authority_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"label" text NOT NULL,
	"ceiling_pence" integer,
	"blocked" boolean DEFAULT false NOT NULL,
	"escalate_to" text
);
--> statement-breakpoint
CREATE TABLE "brand_axis_weights" (
	"brand_id" uuid NOT NULL,
	"axis_key" text NOT NULL,
	"weight" real NOT NULL,
	CONSTRAINT "brand_axis_weights_brand_id_axis_key_pk" PRIMARY KEY("brand_id","axis_key")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"segment" text,
	"location" text,
	"agent_name" text,
	"is_live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" "channel" NOT NULL,
	"address" text,
	"detail" text,
	"state" text DEFAULT 'not_connected' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"label" text NOT NULL,
	"amount_pence" integer,
	"at_seconds" integer,
	"allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"customer_id" uuid,
	"channel" "channel" NOT NULL,
	"intent" text,
	"status" "conversation_status" DEFAULT 'live' NOT NULL,
	"outcome" "outcome",
	"agent_version_id" uuid,
	"handled_by" text,
	"sentiment_start" real,
	"sentiment_end" real,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"contained" boolean,
	"review_score" integer,
	"reviewer_name" text
);
--> statement-breakpoint
CREATE TABLE "customer_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"model_score" real NOT NULL,
	"override_delta" real DEFAULT 0 NOT NULL,
	"blended" real NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_signals" (
	"customer_id" uuid NOT NULL,
	"axis_key" text NOT NULL,
	"value" real NOT NULL,
	"display" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_signals_customer_id_axis_key_pk" PRIMARY KEY("customer_id","axis_key")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"external_ref" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"location" text,
	"segment" text,
	"tier" text,
	"owner" text,
	"customer_since" timestamp with time zone,
	"ltv_pence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"anchor" text,
	"content" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"collection" text DEFAULT 'Uncategorised' NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'Policy' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"owner_name" text,
	"status" "doc_status" DEFAULT 'published' NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"success_rate" real,
	"source_system" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"description" text NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"default_on" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "handoff_status" DEFAULT 'waiting' NOT NULL,
	"waiting_since" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_membership_id" uuid,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"severity" text NOT NULL,
	"region_key" text,
	"note" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"affected_org_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "integrations_org_name_key" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"reason" text DEFAULT 'no_document' NOT NULL,
	"draft_document_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_brands" (
	"membership_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "membership_brands_membership_id_brand_id_pk" PRIMARY KEY("membership_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"all_brands" boolean DEFAULT false NOT NULL,
	"invited_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "never_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_feature_flags" (
	"org_id" uuid NOT NULL,
	"flag_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "org_feature_flags_org_id_flag_key_pk" PRIMARY KEY("org_id","flag_key")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" "plan" DEFAULT 'trial' NOT NULL,
	"region" text DEFAULT 'eu-west-2' NOT NULL,
	"health_score" integer,
	"mrr_pence" integer DEFAULT 0 NOT NULL,
	"seat_count" integer DEFAULT 0 NOT NULL,
	"renews_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "priority_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"condition" jsonb NOT NULL,
	"effect" real NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_name" text,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"turn_id" uuid,
	"failure_class" text NOT NULL,
	"root_cause" text,
	"owner" text DEFAULT 'tenant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"voice_p95_ms" integer,
	"uptime_30d" numeric(5, 2),
	"state" text DEFAULT 'healthy' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_axes" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source" text DEFAULT 'model' NOT NULL,
	"inverted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "support_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"approved_by_membership_id" uuid
);
--> statement-breakpoint
CREATE TABLE "turn_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"document_id" uuid,
	"chunk_id" uuid,
	"confidence" real,
	"check_label" text,
	"quote" text
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"speaker" "speaker" NOT NULL,
	"author_name" text,
	"body" text NOT NULL,
	"sentiment" real,
	"at_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_limits" ADD CONSTRAINT "authority_limits_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_axis_weights" ADD CONSTRAINT "brand_axis_weights_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_axis_weights" ADD CONSTRAINT "brand_axis_weights_axis_key_scoring_axes_key_fk" FOREIGN KEY ("axis_key") REFERENCES "public"."scoring_axes"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_actions" ADD CONSTRAINT "conversation_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_scores" ADD CONSTRAINT "customer_scores_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_signals" ADD CONSTRAINT "customer_signals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_signals" ADD CONSTRAINT "customer_signals_axis_key_scoring_axes_key_fk" FOREIGN KEY ("axis_key") REFERENCES "public"."scoring_axes"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_triggers" ADD CONSTRAINT "escalation_triggers_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_accepted_by_membership_id_memberships_id_fk" FOREIGN KEY ("accepted_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_region_key_regions_key_fk" FOREIGN KEY ("region_key") REFERENCES "public"."regions"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_draft_document_id_documents_id_fk" FOREIGN KEY ("draft_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_brands" ADD CONSTRAINT "membership_brands_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_brands" ADD CONSTRAINT "membership_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "never_rules" ADD CONSTRAINT "never_rules_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_feature_flags" ADD CONSTRAINT "org_feature_flags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_feature_flags" ADD CONSTRAINT "org_feature_flags_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_rules" ADD CONSTRAINT "priority_rules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD CONSTRAINT "quality_flags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_flags" ADD CONSTRAINT "quality_flags_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_approved_by_membership_id_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_citations" ADD CONSTRAINT "turn_citations_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_citations" ADD CONSTRAINT "turn_citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_citations" ADD CONSTRAINT "turn_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_brand_version_idx" ON "agent_versions" USING btree ("brand_id","version");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_limits_version_action_idx" ON "authority_limits" USING btree ("agent_version_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_slug_idx" ON "brands" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_brand_kind_idx" ON "channels" USING btree ("brand_id","kind");--> statement-breakpoint
CREATE INDEX "conversation_actions_conversation_idx" ON "conversation_actions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_brand_started_idx" ON "conversations" USING btree ("brand_id","started_at");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("customer_id","started_at");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "customer_scores_customer_idx" ON "customer_scores" USING btree ("customer_id","computed_at");--> statement-breakpoint
CREATE INDEX "customers_brand_idx" ON "customers" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_brand_ref_idx" ON "customers" USING btree ("brand_id","external_ref");--> statement-breakpoint
CREATE INDEX "document_chunks_doc_idx" ON "document_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_chunks_brand_idx" ON "document_chunks" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "documents_brand_idx" ON "documents" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "handoffs_brand_status_idx" ON "handoffs" USING btree ("brand_id","status","waiting_since");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_gaps_brand_intent_idx" ON "knowledge_gaps" USING btree ("brand_id","intent");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("org_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "priority_rules_brand_idx" ON "priority_rules" USING btree ("brand_id","ordinal");--> statement-breakpoint
CREATE INDEX "quality_flags_org_idx" ON "quality_flags" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "segments_brand_idx" ON "segments" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "support_grants_org_idx" ON "support_grants" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE INDEX "turn_citations_turn_idx" ON "turn_citations" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_conversation_ordinal_idx" ON "turns" USING btree ("conversation_id","ordinal");