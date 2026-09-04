ALTER TABLE "conversations" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_is_test_idx" ON "conversations" USING btree ("brand_id","is_test");