import Razorpay from "razorpay";
import { getTenantSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BUYABLE, PLANS, isTier } from "@/lib/billing/plans";
import { razorpayConfig, razorpayError } from "@/lib/billing/razorpay";
import { accountState, quote } from "@/lib/billing/usage";
import { allow } from "@/lib/rate-limit";

/**
 * POST /api/razorpay/order { tier } — open a Razorpay order for a plan.
 *
 * The body is a plan, never an amount: the price (plan + any overage owed on
 * the period being closed + GST) is worked out here, so the page cannot name
 * its own. Who is buying, and for which business, is stamped into the order's
 * notes — the webhook arrives with no session and has only those to go on.
 */

export const dynamic = "force-dynamic";

const WINDOW_SECONDS = 10 * 60;
const MAX_ORDERS = 8;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const session = await getTenantSession();
  if (!session) return fail(401, "Sign in before starting a payment.");
  if (!can(session.actor, "billing.manage").allowed) return fail(403, "Only an Owner or Admin can change the plan.");

  if (!(await allow(`order:${session.orgId}`, MAX_ORDERS, WINDOW_SECONDS))) return fail(429, "Too many attempts. Try again in a few minutes.");

  const config = razorpayConfig();
  // 503, not 500: payments are unconfigured rather than broken.
  if (!config.ok) return fail(503, "Online payment is not switched on yet. Ask Corva to set up your plan.");

  const body = (await request.json().catch(() => ({}))) as { tier?: unknown };
  if (!isTier(body.tier) || !BUYABLE.includes(body.tier)) return fail(400, "Choose the Starter or Growth plan.");
  const plan = PLANS[body.tier];

  const state = await accountState(session.orgId);
  if (state.counts.brands > plan.brands) {
    return fail(400, `${plan.name} covers ${plan.brands === 1 ? "one brand" : `${plan.brands} brands`}; you have ${state.counts.brands}.`);
  }
  if (state.counts.members > plan.members) {
    return fail(400, `${plan.name} covers ${plan.members} team members; you have ${state.counts.members}. Remove some in People & roles first.`);
  }
  const price = quote(plan, state);
  if (!price) return fail(400, "That plan is arranged with Corva directly.");

  try {
    const razorpay = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
    const order = await razorpay.orders.create({
      amount: price.totalPaise,
      currency: "INR",
      // Razorpay truncates receipts past 40 characters.
      receipt: `corva_${plan.id}_${Date.now().toString(36)}`.slice(0, 40),
      notes: {
        orgId: session.orgId,
        tier: plan.id,
        planPaise: String(Math.round(price.planRupees * 100)),
        overagePaise: String(Math.round(price.overageRupees * 100)),
        gstPaise: String(Math.round(price.gstRupees * 100)),
        paidBy: session.name,
      },
    });
    return Response.json({
      ok: true,
      // The key id is public by design; sending it here means the browser
      // cannot be holding a different account's key than the order was made on.
      keyId: config.keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planName: plan.name,
      description: `Corva ${plan.name} — 1 month for ${session.orgName}`,
      prefill: { name: session.name, email: session.email },
    });
  } catch (error) {
    const { statusCode, description } = razorpayError(error);
    console.error("[razorpay] order failed:", statusCode, description);
    // A 401 from Razorpay means our keys are wrong — not the caller's doing.
    return fail(statusCode === 401 ? 503 : 502, statusCode === 401 ? "Payment is misconfigured on our side. Please tell Corva." : description);
  }
}
