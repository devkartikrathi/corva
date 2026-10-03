import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { ApiError, handle } from "@/lib/integrations/api";
import { paymentJson, recordPayment } from "@/lib/payments";

/**
 * POST /api/v1/payments — where a payment to the business stands: asked for,
 * paid, expired. Send it on every change; the same `reference` replaces what
 * was there, and a status never moves backwards. See docs/PAYMENTS.md.
 */
export const POST = handle<Record<string, unknown>>(async (brand, body) => {
  const { payment, created } = await recordPayment(brand, body);
  return { payment: paymentJson(payment), created };
});

/** GET /api/v1/payments?reference= | ?customerId= — what Corva holds. */
export const GET = handle<unknown>(async (brand, _body, req) => {
  const q = new URL(req.url).searchParams;
  const reference = q.get("reference");
  const customerId = q.get("customerId");
  if (!reference && !customerId) throw new ApiError(400, "Give reference or customerId.");
  if (!reference && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId!)) throw new ApiError(400, "customerId is not a valid id.");
  const rows = await db
    .select()
    .from(s.customerPayments)
    .where(
      and(
        eq(s.customerPayments.brandId, brand.id),
        reference ? eq(s.customerPayments.reference, reference) : eq(s.customerPayments.customerId, customerId!),
      ),
    )
    .orderBy(desc(s.customerPayments.createdAt))
    .limit(50);
  return { payments: rows.map(paymentJson) };
});
