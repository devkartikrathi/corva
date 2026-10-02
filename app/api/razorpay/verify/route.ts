import Razorpay from "razorpay";
import { revalidatePath } from "next/cache";
import { getTenantSession } from "@/lib/auth/session";
import { isTier } from "@/lib/billing/plans";
import { grantPlan, recordPayment, type OrderNotes } from "@/lib/billing/payments";
import { razorpayConfig, verifyPaymentSignature } from "@/lib/billing/razorpay";

/**
 * POST /api/razorpay/verify — the browser reporting back from checkout.
 *
 * Everything it sends came through a channel the user controls, so none of it
 * is believed until the signature checks out against the key secret. What was
 * bought is then read from the order on Razorpay's side (its notes), not from
 * the request. A verified payment moves the plan straight away; the webhook
 * does the same for a payer who closed the tab, and whichever is second does
 * nothing.
 */

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ ok: false, verified: false, error }, { status });

export async function POST(request: Request) {
  const config = razorpayConfig();
  if (!config.ok) return fail(503, "Online payment is not switched on.");

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
    return fail(400, "Missing payment details.");
  }
  if (!verifyPaymentSignature({ orderId, paymentId, signature, keySecret: config.keySecret })) {
    return fail(400, "Signature mismatch — this payment was not confirmed by Razorpay.");
  }

  const session = await getTenantSession();
  try {
    const razorpay = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
    const order = await razorpay.orders.fetch(orderId);
    const notes = (order.notes ?? {}) as OrderNotes;
    // The order says which business; the session must be someone in it.
    if (session && typeof notes.orgId === "string" && notes.orgId !== session.orgId) {
      return fail(403, "That payment belongs to another business.");
    }
    const { orgId, tier } = await recordPayment({
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      status: "verified",
      amountPaise: Number(order.amount),
      notes,
      email: session?.email ?? null,
    });
    const granted = orgId && isTier(tier) ? await grantPlan(paymentId, orgId, tier) : false;
    revalidatePath("/app", "layout");
    return Response.json({ ok: true, verified: true, granted, tier });
  } catch (error) {
    console.error("[razorpay] could not record a verified payment", error);
    // The money is real and the webhook will still grant the plan.
    return Response.json({ ok: true, verified: true, granted: false, pending: true });
  }
}
