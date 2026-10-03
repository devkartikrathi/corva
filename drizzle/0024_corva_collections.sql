CREATE TABLE "collection_settings" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fee_basis_points" integer DEFAULT 0 NOT NULL,
	"route_account_id" text,
	"payout_note" text,
	"enabled_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "collected_by" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "provider_link_id" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "fee_paise" integer;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "settlement_ref" text;--> statement-breakpoint
ALTER TABLE "collection_settings" ADD CONSTRAINT "collection_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;