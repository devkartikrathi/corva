import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { discountFor, type AppliedOffer } from "./offers";
import * as s from "@/lib/db/schema";
import { APP_URL } from "@/lib/email";
import { referenceKey } from "@/lib/integrations/records";
import { formatRupees } from "@/lib/money";

/**
 * Collected by Corva: payment links on Corva's own Razorpay account, for a
 * business that has no payment system of its own.
 *
 * The other path (a business's own endpoint, `askForPayment`) keeps the money
 * with the business. This one does not: the customer pays Corva, and Corva
 * owes the business the amount less its fee. So it is switched on per
 * business by Corva (`collection_settings`), every payment records who holds
 * the money (`collected_by = 'corva'`), its fee, and when it was paid out.
 * Payouts are by hand until a business has a Razorpay Route linked account
 * (`routeAccountId`), when transfers can be made on each payment.
 *
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET  Corva's own account (the same one plan billing uses)
 *   RAZORPAY_COLLECT_WEBHOOK_SECRET        the webhook at /api/razorpay/collect —
 *                                          its own webhook, subscribed to payment_link.* only
 *
 * Every link carries `notes.corvaCollect`, so the plan-billing webhook can
 * tell a customer's payment from a business paying for its plan.
 */

const API = "https://api.razorpay.com/v1";
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PAISE = 100;
const MAX_PAISE = 5_00_000_00;

export class CollectionError extends Error {}

export function corvaRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? { keyId, keySecret, test: keyId.startsWith("rzp_test_") } : null;
}

export const collectWebhookSecret = () => process.env.RAZORPAY_COLLECT_WEBHOOK_SECRET?.trim() || null;

/** This business's Corva-collection settings, when switched on. */
export async function collectionFor(brandId: string) {
  const [row] = await db.select().from(s.collectionSettings).where(and(eq(s.collectionSettings.brandId, brandId), eq(s.collectionSettings.enabled, true))).limit(1);
  return row ?? null;
}

type LinkEntity = {
  id: string;
  short_url: string;
  status: "created" | "partially_paid" | "paid" | "expired" | "cancelled";
  amount_paid: number;
  reference_id: string;
  expire_by: number;
};

async function razorpay<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const keys = corvaRazorpay();
  if (!keys) throw new CollectionError("Corva's payment account is not set up yet.");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { description?: string } }) | null;
  if (!res.ok || !json) throw new CollectionError(json?.error?.description ?? `The payment provider answered ${res.status}.`);
  return json;
}

/** "+919876543210", or nothing — Razorpay refuses a contact it cannot read rather than ignoring it. */
function contact(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const full = digits.length === 10 ? `+91${digits}` : digits ? `+${digits}` : "";
  return full.length >= 8 && full.length <= 14 ? full : null;
}

/**
 * What is owed on an order the business told Corva about (POST /api/v1/records):
 * its amount, less what has been paid against it. Null when there is no such
 * order or it carries no amount — then nobody but a person may name a figure.
 */
export async function owedOnOrder(brandId: string, orderReference: string) {
  const key = referenceKey(orderReference);
  if (key.length < 3) return null;
  const [record] = await db
    .select({ amountPaise: s.customerRecords.amountPaise, customerId: s.customerRecords.customerId, ref: s.customerRecords.ref })
    .from(s.customerRecords)
    .innerJoin(s.customers, eq(s.customers.id, s.customerRecords.customerId))
    .where(and(eq(s.customers.brandId, brandId), sql`regexp_replace(upper(${s.customerRecords.ref}), '[^A-Z0-9]', '', 'g') = ${key}`))
    .limit(1);
  if (!record) return { found: false as const };
  if (record.amountPaise == null) return { found: true as const, amountPaise: null, customerId: record.customerId, reference: record.ref };
  const [paid] = await db
    .select({ n: sql<number>`coalesce(sum(${s.customerPayments.amountPaidPaise}), 0)::int` })
    .from(s.customerPayments)
    .where(
      and(
        eq(s.customerPayments.brandId, brandId),
        inArray(s.customerPayments.status, ["paid", "partially_paid"]),
        sql`regexp_replace(upper(coalesce(${s.customerPayments.orderReference}, '')), '[^A-Z0-9]', '', 'g') = ${key}`,
      ),
    );
  return { found: true as const, amountPaise: Math.max(0, record.amountPaise - paid.n), customerId: record.customerId, reference: record.ref };
}

/** Make a link on Corva's account and record it as owed to the business. */
export async function collectForBusiness(input: {
  brandId: string;
  conversationId: string | null;
  customerId: string | null;
  orderReference: string | null;
  amountPaise: number | null;
  description: string | null;
  requestedByName: string;
  byAi: boolean;
  /** A published offer, already checked for this customer: taken off here, in code. */
  offer?: AppliedOffer | null;
}) {
  const settings = await collectionFor(input.brandId);
  if (!settings) throw new CollectionError("This business has not set up payments yet.");
  const [brand] = await db.select({ name: s.brands.name }).from(s.brands).where(eq(s.brands.id, input.brandId)).limit(1);

  let amountPaise = input.amountPaise;
  let customerId = input.customerId;
  let orderReference = input.orderReference?.trim() || null;
  if (amountPaise == null) {
    if (!orderReference) throw new CollectionError("Give an order reference or an amount.");
    const owed = await owedOnOrder(input.brandId, orderReference);
    if (!owed?.found) throw new CollectionError(`No order ${orderReference}.`);
    if (owed.amountPaise == null) throw new CollectionError("There is no bill on this order yet.");
    if (owed.amountPaise === 0) throw new CollectionError("Nothing is owed on this order.");
    amountPaise = owed.amountPaise;
    customerId ??= owed.customerId;
    orderReference = owed.reference ?? orderReference;
  }
  let offerNote = "";
  if (input.offer) {
    const off = discountFor(input.offer, amountPaise);
    if (off > 0) {
      amountPaise -= off;
      offerNote = ` (${input.offer.code}: ${formatRupees(off, { decimals: "auto" })} off)`;
    }
  }
  if (!Number.isInteger(amountPaise) || amountPaise < MIN_PAISE || amountPaise > MAX_PAISE) {
    throw new CollectionError(`The amount must be between ${formatRupees(MIN_PAISE)} and ${formatRupees(MAX_PAISE)}.`);
  }

  const [customer] = customerId ? await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1) : [];
  const reference = `CP-${Array.from(randomBytes(8), (b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32]).join("")}`;
  const description = `${brand?.name ?? "Payment"} — ${input.description?.trim() || (orderReference ? `order ${orderReference}` : "payment")}${offerNote}`.slice(0, 500);
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
  const feePaise = Math.round((amountPaise * settings.feeBasisPoints) / 10_000);

  const [row] = await db
    .insert(s.customerPayments)
    .values({
      brandId: input.brandId,
      customerId: customer?.id ?? null,
      conversationId: input.conversationId,
      reference,
      status: "pending",
      amountPaise,
      description,
      orderReference,
      requestedByName: input.requestedByName,
      requestedByAi: input.byAi,
      collectedBy: "corva",
      feePaise,
      pageUrl: `${APP_URL}/pay/${reference}`,
      expiresAt,
    })
    .returning();

  try {
    const phone = contact(customer?.phone);
    const link = await razorpay<LinkEntity>("POST", "/payment_links", {
      amount: amountPaise,
      currency: "INR",
      accept_partial: false,
      reference_id: reference,
      description,
      customer: { ...(customer && !/^\+?[\d\s()-]{7,}$/.test(customer.name) ? { name: customer.name } : {}), ...(phone ? { contact: phone } : {}), ...(customer?.email ? { email: customer.email } : {}) },
      notify: { sms: Boolean(phone), email: Boolean(customer?.email) },
      reminder_enable: true,
      callback_url: `${APP_URL}/pay/${reference}`,
      callback_method: "get",
      expire_by: Math.floor(expiresAt.getTime() / 1000),
      // Read back by the webhooks: which business, which row, and "not a plan payment".
      notes: { corvaCollect: "1", brandId: input.brandId, paymentId: row.id },
    });
    const [ready] = await db
      .update(s.customerPayments)
      .set({ providerLinkId: link.id, url: link.short_url, updatedAt: new Date() })
      .where(eq(s.customerPayments.id, row.id))
      .returning();
    return ready;
  } catch (e) {
    await db.update(s.customerPayments).set({ status: "failed", updatedAt: new Date() }).where(eq(s.customerPayments.id, row.id));
    throw e instanceof CollectionError ? e : new CollectionError("The payment link could not be made just now.");
  }
}

/** Where Corva's link stands, as Razorpay reports it — fields for `recordPayment`. */
export async function hostedLinkFacts(linkId: string) {
  const link = await razorpay<LinkEntity & { payments?: { payment_id: string; method?: string; status: string }[] | null }>("GET", `/payment_links/${encodeURIComponent(linkId)}`);
  const settled = link.payments?.find((p) => p.status === "captured") ?? link.payments?.[0];
  return { link, paymentId: settled?.payment_id ?? null, method: settled?.method ?? null };
}

export const LINK_STATUS: Record<LinkEntity["status"], string> = {
  created: "pending",
  partially_paid: "partially_paid",
  paid: "paid",
  expired: "expired",
  cancelled: "cancelled",
};

function matches(received: string, expected: string) {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCollectWebhook(body: string, signature: string | null) {
  const secret = collectWebhookSecret();
  return Boolean(secret && signature) && matches(signature!, createHmac("sha256", secret!).update(body).digest("hex"));
}

/** The customer's signed return from a paid link: HMAC of `link|reference|status|payment` with the key secret. */
export function verifyReturn(p: { linkId: string; reference: string; status: string; paymentId: string; signature: string }) {
  const keys = corvaRazorpay();
  if (!keys) return false;
  return matches(p.signature, createHmac("sha256", keys.keySecret).update(`${p.linkId}|${p.reference}|${p.status}|${p.paymentId}`).digest("hex"));
}

/** What Corva holds for a business and has not yet paid out. */
export async function owedToBusiness(brandId: string) {
  const [row] = await db
    .select({
      collected: sql<number>`coalesce(sum(${s.customerPayments.amountPaidPaise}), 0)::int`,
      fees: sql<number>`coalesce(sum(${s.customerPayments.feePaise}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(s.customerPayments)
    .where(
      and(
        eq(s.customerPayments.brandId, brandId),
        eq(s.customerPayments.collectedBy, "corva"),
        eq(s.customerPayments.status, "paid"),
        sql`${s.customerPayments.settledAt} is null`,
      ),
    );
  return { collectedPaise: row.collected, feePaise: row.fees, owedPaise: row.collected - row.fees, payments: row.count };
}
