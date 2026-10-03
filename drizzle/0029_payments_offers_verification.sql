CREATE TABLE "offer_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_reference" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"max_discount_paise" integer,
	"min_order_paise" integer,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"once_per_customer" boolean DEFAULT true NOT NULL,
	"exclude_segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"conversation_id" uuid,
	"customer_id" uuid,
	"order_reference" text NOT NULL,
	"offer" jsonb,
	"identified_by" text,
	"requested_by_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"payment_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_policies" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"verify_first" boolean DEFAULT true NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"conversation_id" uuid,
	"customer_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD COLUMN "opening_template" jsonb;--> statement-breakpoint
ALTER TABLE "offer_uses" ADD CONSTRAINT "offer_uses_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_uses" ADD CONSTRAINT "offer_uses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_policies" ADD CONSTRAINT "payment_policies_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_uses_offer_customer_idx" ON "offer_uses" USING btree ("offer_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_brand_code_idx" ON "offers" USING btree ("brand_id","code");--> statement-breakpoint
CREATE INDEX "payment_approvals_brand_idx" ON "payment_approvals" USING btree ("brand_id","status","created_at");--> statement-breakpoint
CREATE INDEX "verification_codes_conversation_idx" ON "verification_codes" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_codes_destination_idx" ON "verification_codes" USING btree ("brand_id","destination","created_at");