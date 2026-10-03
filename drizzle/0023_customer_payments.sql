CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"customer_id" uuid,
	"conversation_id" uuid,
	"request_id" text,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_paise" integer NOT NULL,
	"amount_paid_paise" integer DEFAULT 0 NOT NULL,
	"description" text,
	"url" text,
	"page_url" text,
	"qr_url" text,
	"method" text,
	"order_reference" text,
	"requested_by_name" text,
	"requested_by_ai" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_payments_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "payment_endpoints" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_called_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_endpoints" ADD CONSTRAINT "payment_endpoints_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_payments_brand_ref_idx" ON "customer_payments" USING btree ("brand_id","reference");--> statement-breakpoint
CREATE INDEX "customer_payments_customer_idx" ON "customer_payments" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_payments_conversation_idx" ON "customer_payments" USING btree ("conversation_id");