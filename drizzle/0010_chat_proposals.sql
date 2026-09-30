CREATE TABLE "chat_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_proposals" ADD CONSTRAINT "chat_proposals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_proposals" ADD CONSTRAINT "chat_proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_proposals_conversation_idx" ON "chat_proposals" USING btree ("conversation_id");