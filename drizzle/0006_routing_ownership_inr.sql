-- Money is rupees now, held in paise. The columns are renamed rather than
-- added-and-backfilled so the values move with them; the seed re-bases the
-- amounts themselves.
ALTER TABLE "organizations" RENAME COLUMN "mrr_pence" TO "mrr_paise";--> statement-breakpoint
ALTER TABLE "customers" RENAME COLUMN "ltv_pence" TO "ltv_paise";--> statement-breakpoint
ALTER TABLE "customer_records" RENAME COLUMN "amount_pence" TO "amount_paise";--> statement-breakpoint
ALTER TABLE "authority_limits" RENAME COLUMN "ceiling_pence" TO "ceiling_paise";--> statement-breakpoint
ALTER TABLE "conversation_actions" RENAME COLUMN "amount_pence" TO "amount_paise";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "cost_pence" TO "cost_paise";--> statement-breakpoint
ALTER TABLE "usage_daily" RENAME COLUMN "cost_pence" TO "cost_paise";--> statement-breakpoint
ALTER TABLE "mrr_snapshots" RENAME COLUMN "mrr_pence" TO "mrr_paise";--> statement-breakpoint

CREATE TYPE "public"."availability" AS ENUM('available', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."handoff_kind" AS ENUM('escalation', 'closure_approval');--> statement-breakpoint

-- Who can take a call, and how well they take it.
ALTER TABLE "memberships" ADD COLUMN "availability" "availability" DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "rating" real;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "specialities" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint

-- Who holds the account. Null is the AI handling it alone, not a mistake.
ALTER TABLE "customers" ADD COLUMN "owner_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_membership_id_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_owner_idx" ON "customers" USING btree ("owner_membership_id");--> statement-breakpoint

-- One line about a call that has not finished yet.
ALTER TABLE "conversations" ADD COLUMN "live_summary" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "live_summary_at" timestamp with time zone;--> statement-breakpoint

-- A handoff now rings at a named person, and knows why it is being raised.
ALTER TABLE "handoffs" ADD COLUMN "kind" "handoff_kind" DEFAULT 'escalation' NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "routed_to_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "routing_reason" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "declined_by" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_routed_to_membership_id_memberships_id_fk" FOREIGN KEY ("routed_to_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoffs_routed_idx" ON "handoffs" USING btree ("routed_to_membership_id","status");
