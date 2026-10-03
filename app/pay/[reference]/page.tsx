import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";
import { recordPayment } from "@/lib/payments";
import { verifyReturn } from "@/lib/payments/hosted";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } };

/**
 * Where a customer lands after paying a link Corva made for a business
 * (Collected by Corva), and the page its reference points at.
 *
 * The return carries Razorpay's signature; when it checks out the payment is
 * recorded now, rather than waiting for the webhook, so the customer sees
 * "paid" the moment they are back. Shows the business, the amount and what it
 * was for — never who the customer is.
 */
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ reference: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { reference } = await params;
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");

  const found = await db
    .select({ p: s.customerPayments, business: s.brands.name })
    .from(s.customerPayments)
    .innerJoin(s.brands, eq(s.brands.id, s.customerPayments.brandId))
    .where(and(eq(s.customerPayments.reference, reference.toUpperCase()), eq(s.customerPayments.collectedBy, "corva")))
    .limit(1);
  if (!found[0]) notFound();
  let p = found[0].p;
  const business = found[0].business;

  const back = {
    linkId: one("razorpay_payment_link_id"),
    reference: one("razorpay_payment_link_reference_id"),
    status: one("razorpay_payment_link_status"),
    paymentId: one("razorpay_payment_id"),
    signature: one("razorpay_signature"),
  };
  if (back.signature && back.linkId === p.providerLinkId && back.reference === p.reference && back.status === "paid" && verifyReturn(back)) {
    p = (await recordPayment({ id: p.brandId }, { reference: p.reference, status: "paid", amountPaidRupees: p.amountPaise / 100 })).payment;
  }

  const payable = p.status === "pending" && p.url && (!p.expiresAt || p.expiresAt > new Date());
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 16px", background: "var(--color-bg)" }}>
      <div style={{ width: "100%", maxWidth: 420, border: "2px solid var(--color-text)", padding: "28px 24px", textAlign: "center", background: "var(--color-surface)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>{business}</div>
        <div style={{ marginTop: 10, fontSize: 40, fontWeight: 800 }}>{formatRupees(p.amountPaise, { decimals: "auto" })}</div>
        {p.description && <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--color-neutral-800)" }}>{p.description}</p>}
        <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--color-neutral-700)" }}>{p.reference}</p>
        {p.status === "paid" ? (
          <div style={{ marginTop: 20, padding: "14px 12px", background: "var(--color-text)", color: "var(--color-bg)" }}>
            <b>Paid — thank you.</b> {business} has been told.
          </div>
        ) : payable ? (
          <a href={p.url!} style={{ display: "block", marginTop: 20, padding: "12px 14px", fontWeight: 800, background: "var(--color-accent)", color: "var(--color-bg)" }}>
            Pay {formatRupees(p.amountPaise, { decimals: "auto" })}
          </a>
        ) : (
          <p style={{ marginTop: 20, fontSize: 13, color: "var(--color-neutral-800)" }}>This payment link is no longer active. Please ask {business} for a new one.</p>
        )}
        <p style={{ marginTop: 18, fontSize: 11, color: "var(--color-neutral-700)" }}>
          Collected securely by Razorpay for {business}, through Corva. Your card and UPI details are never seen by either.
        </p>
      </div>
    </main>
  );
}
