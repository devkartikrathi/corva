CREATE TABLE "email_inboxes" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"confirmation" jsonb,
	"received" integer DEFAULT 0 NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_inboxes_local_part_unique" UNIQUE("local_part")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"conversation_id" uuid,
	"direction" text NOT NULL,
	"provider_id" text,
	"message_id" text,
	"address" text,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_conversation_idx" ON "email_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "email_messages_message_idx" ON "email_messages" USING btree ("brand_id","message_id");