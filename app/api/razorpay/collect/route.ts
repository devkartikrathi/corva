import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { recordPayment } from "@/lib/payments";
import { LINK_STATUS, collectWebhookSecret, verifyCollectWebhook } from "@/lib/payments/hosted";

/**
 * POST /api/razorpay/collect — Razorpay reporting a payment link Corva made
 * for a business (Collected by Corva, lib/payments/hosted.ts).
 *
 * Its own webhook in Razorpay's dashboard, subscribed to payment_link.paid,
 * .partially_paid, .expired and .cancelled, with RAZORPAY_COLLECT_WEBHOOK_SECRET
 * — separate from the plan-billing webhook, so neither can mistake one kind
 * of payment for the other. Public; the signature over the raw body is its
 * security. A status never moves backwards (`recordPayment`), so a delivery
 * made twice or late changes nothing; a storage failure answers 500 so
 * Razorpay retries.
 */

export const dynamic = "force-dynamic";

type Envelope = {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string; status?: keyof typeof LINK_STATUS; amount_paid?: number; reference_id?: string; notes?: Record<string, string> } };
    payment?: { entity?: { id?: string; method?: string } };
  };
};

export async function POST(req: Request) {
  if (!collectWebhookSecret()) return Response.json({ error: "RAZORPAY_COLLECT_WEBHOOK_SECRET is not set; deliveries are refused." }, { status: 503 });
  const raw = await req.text();
  if (!verifyCollectWebhook(raw, req.headers.get("x-razorpay-signature"))) return Response.json({ error: "Bad signature." }, { status: 401 });

  let event: Envelope;
  try {
    event = JSON.parse(raw) as Envelope;
  } catch {
    return Response.json({ error: "Body is not JSON." }, { status: 400 });
  }
  const link = event.payload?.payment_link?.entity;
  if (!event.event?.startsWith("payment_link.") || !link?.id || !link.status || !(link.status in LINK_STATUS)) {
    return Response.json({ ok: true, ignored: event.event ?? "unnamed" });
  }

  try {
    const [row] = await db.select().from(s.customerPayments).where(and(eq(s.customerPayments.providerLinkId, link.id), eq(s.customerPayments.collectedBy, "corva"))).limit(1);
    // A link Corva did not make for a business (another app on the account): acknowledged, left alone.
    if (!row) return Response.json({ ok: true, ignored: "not a collection link" });

    const payment = event.payload?.payment?.entity;
    const { payment: updated } = await recordPayment({ id: row.brandId }, {
      reference: row.reference,
      status: LINK_STATUS[link.status],
      amountPaidRupees: (link.amount_paid ?? 0) / 100,
      method: payment?.method,
    });
    if (payment?.id && !updated.providerPaymentId) {
      await db.update(s.customerPayments).set({ providerPaymentId: payment.id }).where(eq(s.customerPayments.id, row.id));
    }
    return Response.json({ ok: true, payment: updated.reference, status: updated.status });
  } catch (e) {
    console.error("[razorpay collect] could not apply", e);
    return Response.json({ error: "Could not record it; please retry." }, { status: 500 });
  }
}
