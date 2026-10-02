// server-only: imported only by route handlers and server components.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay, server side. The same shape as the integration in myfin:
 *
 * - the browser never names a price — it sends a plan, and the amount is
 *   worked out here (lib/billing/usage.ts `quote`);
 * - what the checkout hands back is only believed once its signature checks
 *   out against the key secret;
 * - the webhook has its own secret, and is what grants a plan when the payer
 *   closed the tab before the browser could report back.
 */

export type RazorpayConfig = { ok: true; keyId: string; keySecret: string } | { ok: false; missing: string[] };

export function razorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const missing: string[] = [];
  if (!keyId) missing.push("RAZORPAY_KEY_ID");
  if (!keySecret) missing.push("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return { ok: false, missing };
  return { ok: true, keyId, keySecret };
}

/** Chosen when the webhook is made in Razorpay's dashboard. Not the API key secret. */
export const razorpayWebhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null;

/** Constant-time hex comparison; a wrong length is a forgery that needs no timing care. */
function matches(received: string, expected: string) {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether `signature` is what Razorpay signs for this order and payment: HMAC of "order_id|payment_id". */
export function verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string; keySecret: string }) {
  const expected = createHmac("sha256", input.keySecret).update(`${input.orderId}|${input.paymentId}`).digest("hex");
  return matches(input.signature, expected);
}

/** Whether a webhook body came from Razorpay. `body` must be the raw text, byte for byte. */
export function verifyWebhookSignature(input: { body: string; signature: string; webhookSecret: string }) {
  const expected = createHmac("sha256", input.webhookSecret).update(input.body).digest("hex");
  return matches(input.signature, expected);
}

/** The SDK rejects with the API's envelope; narrow it rather than trusting it. */
export function razorpayError(error: unknown): { statusCode: number; description: string } {
  if (typeof error === "object" && error !== null && "error" in error) {
    const envelope = error as { statusCode?: number; error?: { description?: string; reason?: string } };
    return {
      statusCode: typeof envelope.statusCode === "number" ? envelope.statusCode : 500,
      description: envelope.error?.description ?? envelope.error?.reason ?? "Razorpay refused the order.",
    };
  }
  return { statusCode: 500, description: error instanceof Error ? error.message : "Razorpay refused the order." };
}
