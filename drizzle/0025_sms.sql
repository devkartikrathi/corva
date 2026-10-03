CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"customer_id" uuid,
	"conversation_id" uuid,
	"to" text NOT NULL,
	"purpose" text NOT NULL,
	"body" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_settings" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'log' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sender_id" text,
	"dlt_entity_id" text,
	"credentials" text,
	"updated_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"body" text NOT NULL,
	"dlt_template_id" text,
	"provider_template_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_settings" ADD CONSTRAINT "sms_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_messages_brand_idx" ON "sms_messages" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_customer_idx" ON "sms_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_templates_brand_purpose_idx" ON "sms_templates" USING btree ("brand_id","purpose");