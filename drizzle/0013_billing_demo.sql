CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"business" text,
	"industry" text,
	"website" text,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"emailed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"status" text NOT NULL,
	"tier" text,
	"amount_paise" integer NOT NULL,
	"plan_paise" integer DEFAULT 0 NOT NULL,
	"overage_paise" integer DEFAULT 0 NOT NULL,
	"gst_paise" integer DEFAULT 0 NOT NULL,
	"method" text,
	"email" text,
	"paid_by_name" text,
	"granted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tier" text DEFAULT 'pilot' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "period_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("org_id");