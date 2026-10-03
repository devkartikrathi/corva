import { isTier } from "@/lib/billing/plans";
import { grantPlan, recordPayment, revokePlan, type OrderNotes, type PaymentStatus } from "@/lib/billing/payments";
import { razorpayWebhookSecret, verifyWebhookSignature } from "@/lib/billing/razorpay";

/**
 * POST /api/razorpay/webhook — Razorpay telling us what happened to a payment.
 *
 * An unauthenticated POST from Razorpay's servers: the signature over the raw
 * body, made with the webhook's own secret, is the only thing that tells a
 * real delivery from anyone posting at a public URL. Without the secret set,
 * every delivery is refused.
 *
 * In Razorpay → Settings → Webhooks, point it at /api/razorpay/webhook and
 * subscribe to payment.captured, payment.failed and refund.processed.
 */

export const dynamic = "force-dynamic";

const STATUS_BY_EVENT: Record<string, PaymentStatus> = {
  "payment.captured": "captured",
  "payment.failed": "failed",
  "payment.refunded": "refunded",
  "refund.created": "refunded",
  "refund.processed": "refunded",
  "payment.dispute.created": "disputed",
  "payment.dispute.lost": "disputed",
};

type PaymentEntity = {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  method?: unknown;
  email?: unknown;
  notes?: OrderNotes;
};

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export async function POST(request: Request) {
  const secret = razorpayWebhookSecret();
  if (!secret) return Response.json({ ok: false, error: "RAZORPAY_WEBHOOK_SECRET is unset — deliveries are refused." }, { status: 503 });

  // The raw text: parsing and re-serialising moves bytes and breaks the signature.
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) return Response.json({ ok: false, error: "Missing x-razorpay-signature." }, { status: 400 });
  if (!verifyWebhookSignature({ body: raw, signature, webhookSecret: secret })) {
    return Response.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let event: { event?: unknown; payload?: { payment?: { entity?: PaymentEntity } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Body is not JSON." }, { status: 400 });
  }
  const name = typeof event.event === "string" ? event.event : "";
  const status = STATUS_BY_EVENT[name];
  // Acknowledge what we do not act on, or Razorpay retries it for a day.
  if (!status) return Response.json({ ok: true, ignored: name || "unnamed event" });

  const entity = event.payload?.payment?.entity;
  // A customer paying a business through a link Corva made for it is not a
  // plan payment: it belongs to /api/razorpay/collect (lib/payments/hosted.ts).
  if ((entity?.notes as Record<string, unknown> | undefined)?.corvaCollect) return Response.json({ ok: true, ignored: "collection payment" });
  const paymentId = text(entity?.id);
  const orderId = text(entity?.order_id);
  if (!paymentId || !orderId || typeof entity?.amount !== "number") {
    console.error("[razorpay] signed webhook missing payment fields", name);
    return Response.json({ ok: true, ignored: "incomplete payment entity" });
  }

  try {
    const { orgId, tier } = await recordPayment({
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      status,
      amountPaise: entity.amount,
      notes: entity.notes ?? {},
      method: text(entity.method),
      email: text(entity.email),
    });
    if ((status === "refunded" || status === "disputed") && orgId) {
      await revokePlan(orgId);
      return Response.json({ ok: true, event: name, revoked: true });
    }
    const granted = status === "captured" && orgId && isTier(tier) ? await grantPlan(paymentId, orgId, tier) : false;
    if (status === "captured" && !orgId) console.error("[razorpay] captured payment names no business", paymentId);
    return Response.json({ ok: true, event: name, granted });
  } catch (error) {
    console.error("[razorpay] failed to record webhook payment", error);
    // A 500 makes Razorpay try again, which is what we want here.
    return Response.json({ ok: false, error: "Could not record the payment." }, { status: 500 });
  }
}
