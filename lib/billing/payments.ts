import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { GRACE_DAYS, isTier, planFor, type Tier } from "./plans";

/**
 * The payments ledger, and what a payment does to a business's plan.
 *
 * A payment is reported twice — by the browser once its signature has been
 * checked, and by Razorpay's webhook — so everything here is safe to run twice:
 * the row is keyed on the payment id, and `granted` flips once.
 */

const DAY = 864e5;

export type PaymentStatus = "verified" | "captured" | "failed" | "refunded" | "disputed";

/** What the order was for, as stamped into its notes when it was created. */
export type OrderNotes = {
  orgId?: unknown;
  tier?: unknown;
  planPaise?: unknown;
  overagePaise?: unknown;
  gstPaise?: unknown;
  paidBy?: unknown;
};

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

export async function recordPayment(input: {
  razorpayPaymentId: string;
  razorpayOrderId: string;
  status: PaymentStatus;
  amountPaise: number;
  notes: OrderNotes;
  method?: string | null;
  email?: string | null;
}) {
  const orgId = typeof input.notes.orgId === "string" ? input.notes.orgId : null;
  const tier = isTier(input.notes.tier) ? input.notes.tier : null;
  // A later "verified" must not overwrite "captured"; a refund always wins.
  const rank: Record<PaymentStatus, number> = { failed: 0, verified: 1, captured: 2, refunded: 3, disputed: 3 };
  const [row] = await db
    .insert(s.payments)
    .values({
      orgId,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpayOrderId: input.razorpayOrderId,
      status: input.status,
      tier,
      amountPaise: input.amountPaise,
      planPaise: int(input.notes.planPaise),
      overagePaise: int(input.notes.overagePaise),
      gstPaise: int(input.notes.gstPaise),
      method: input.method ?? null,
      email: input.email ?? null,
      paidByName: typeof input.notes.paidBy === "string" ? input.notes.paidBy : null,
    })
    .onConflictDoUpdate({
      target: s.payments.razorpayPaymentId,
      set: {
        status: sql`case when ${rank[input.status]} >= (case ${s.payments.status} when 'failed' then 0 when 'verified' then 1 when 'captured' then 2 else 3 end) then ${input.status} else ${s.payments.status} end`,
        method: sql`coalesce(${input.method ?? null}, ${s.payments.method})`,
        email: sql`coalesce(${input.email ?? null}, ${s.payments.email})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return { row, orgId, tier };
}

/**
 * Put the business on the plan this payment bought — once.
 *
 * A fresh period starts now: the overage owed on the old one was part of the
 * charge, so usage counts from zero again.
 */
export async function grantPlan(razorpayPaymentId: string, orgId: string, tier: Tier) {
  const [claimed] = await db
    .update(s.payments)
    .set({ granted: true, updatedAt: new Date() })
    .where(and(eq(s.payments.razorpayPaymentId, razorpayPaymentId), eq(s.payments.granted, false)))
    .returning({ id: s.payments.id });
  if (!claimed) return false;

  const now = new Date();
  await db
    .update(s.organizations)
    .set({ tier, periodStart: now, periodEnd: new Date(now.getTime() + planFor(tier).periodDays * DAY) })
    .where(eq(s.organizations.id, orgId));
  return true;
}

/** A refund or a lost dispute ends the period it paid for — at once, with no days of grace. */
export async function revokePlan(orgId: string) {
  const ended = new Date(Date.now() - (GRACE_DAYS * DAY + 60_000));
  await db.update(s.organizations).set({ periodEnd: ended }).where(eq(s.organizations.id, orgId));
}

export async function paymentsFor(orgId: string) {
  return db.select().from(s.payments).where(eq(s.payments.orgId, orgId)).orderBy(sql`${s.payments.createdAt} desc`).limit(24);
}
