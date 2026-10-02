ALTER TABLE "account_notes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_flags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incident_updates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_alerts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mrr_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_feature_flags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_dependencies" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_grants" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account_notes" CASCADE;--> statement-breakpoint
DROP TABLE "feature_flags" CASCADE;--> statement-breakpoint
DROP TABLE "incident_updates" CASCADE;--> statement-breakpoint
DROP TABLE "incidents" CASCADE;--> statement-breakpoint
DROP TABLE "model_alerts" CASCADE;--> statement-breakpoint
DROP TABLE "mrr_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "org_feature_flags" CASCADE;--> statement-breakpoint
DROP TABLE "platform_dependencies" CASCADE;--> statement-breakpoint
DROP TABLE "regions" CASCADE;--> statement-breakpoint
DROP TABLE "segments" CASCADE;--> statement-breakpoint
DROP TABLE "staff" CASCADE;--> statement-breakpoint
DROP TABLE "support_grants" CASCADE;--> statement-breakpoint
ALTER TABLE "quality_flags" DROP CONSTRAINT IF EXISTS "quality_flags_assigned_to_staff_id_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "quality_flags" DROP COLUMN "assigned_to_staff_id";