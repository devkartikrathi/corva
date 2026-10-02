CREATE TABLE "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_number" text NOT NULL,
	"verified_name" text,
	"token" text NOT NULL,
	"app_secret" text NOT NULL,
	"verify_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_error" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_seen" (
	"message_id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_numbers_brand_idx" ON "whatsapp_numbers" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_numbers_phone_idx" ON "whatsapp_numbers" USING btree ("phone_number_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_numbers_verify_idx" ON "whatsapp_numbers" USING btree ("verify_token");