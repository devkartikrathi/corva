import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";

/**
 * Discounts the business has published — and nothing else.
 *
 * The assistant never decides a discount. It knows the active offers by code;
 * when a customer names one, `checkOffer` decides here, in code, whether it
 * applies to them (dates, first order, once per customer, segments it is not
 * for). Only a valid offer can ride on a payment request, and the amount with
 * it applied is worked out by the business's system or by Corva — never by the
 * model. Any other discount is the team's to give. See
 * docs/PAYMENTS-AND-VERIFICATION.md.
 */

export type Offer = typeof s.offers.$inferSelect;

/** What travels with a payment request: enough for a person or a payment system to apply it. */
export type AppliedOffer = {
  code: string;
  title: string;
  kind: "percent" | "flat";
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number | null;
};

export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

/** In words, for the assistant and the team: "20% off (up to ₹200), orders over ₹500, first order only". */
export function describeOffer(o: Pick<Offer, "kind" | "value" | "maxDiscountPaise" | "minOrderPaise" | "firstOrderOnly" | "oncePerCustomer" | "excludeSegments" | "endsAt">) {
  const what = o.kind === "percent" ? `${o.value}% off${o.maxDiscountPaise ? ` (up to ${formatRupees(o.maxDiscountPaise)})` : ""}` : `${formatRupees(o.value)} off`;
  return [
    what,
    o.minOrderPaise ? `on orders over ${formatRupees(o.minOrderPaise)}` : null,
    o.firstOrderOnly ? "first order only" : null,
    o.oncePerCustomer ? "once per customer" : null,
    o.excludeSegments?.length ? `not for ${o.excludeSegments.join(", ")} customers` : null,
    o.endsAt ? `until ${o.endsAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function offersFor(brandId: string) {
  return db.select().from(s.offers).where(eq(s.offers.brandId, brandId)).orderBy(asc(s.offers.createdAt));
}

const running = (o: Offer, now = new Date()) => o.active && (!o.startsAt || o.startsAt <= now) && (!o.endsAt || o.endsAt >= now);

/** The offers the assistant may mention, as lines for its instructions. */
export async function offersForAssistant(brandId: string) {
  const live = (await offersFor(brandId)).filter((o) => running(o));
  return live.map((o) => `- ${o.code}: ${o.title} — ${describeOffer(o)}`);
}

/**
 * Whether an offer applies to this customer. Decided here, not by the model:
 * a code that is not published, has ended, is for first orders only, has been
 * used, or is not for their kind of customer is refused with the reason.
 */
export async function checkOffer(brandId: string, customerId: string | null, rawCode: string) {
  const code = normaliseCode(rawCode);
  if (!code) return { valid: false as const, reason: "No code was given." };
  const [offer] = await db.select().from(s.offers).where(and(eq(s.offers.brandId, brandId), eq(s.offers.code, code))).limit(1);
  if (!offer || !offer.active) return { valid: false as const, reason: `${code} is not an offer the business has. Do not offer any other discount; the team can be asked.` };
  const now = new Date();
  if (offer.startsAt && offer.startsAt > now) return { valid: false as const, reason: `${code} has not started yet.` };
  if (offer.endsAt && offer.endsAt < now) return { valid: false as const, reason: `${code} has ended.` };

  if (customerId) {
    const [customer] = await db.select({ segment: s.customers.segment }).from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    if (customer?.segment && offer.excludeSegments.includes(customer.segment)) {
      return { valid: false as const, reason: `${code} is not available to this customer.` };
    }
    if (offer.firstOrderOnly) {
      const [orders] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.customerRecords)
        .where(and(eq(s.customerRecords.customerId, customerId), sql`${s.customerRecords.kind} in ('order','booking')`, sql`coalesce(${s.customerRecords.status}, '') !~* 'cancel'`));
      const [paid] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.customerPayments)
        .where(and(eq(s.customerPayments.customerId, customerId), eq(s.customerPayments.status, "paid")));
      if ((orders?.n ?? 0) > 1 || (paid?.n ?? 0) > 0) return { valid: false as const, reason: `${code} is for a first order only.` };
    }
    if (offer.oncePerCustomer) {
      const [used] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.offerUses)
        .where(and(eq(s.offerUses.offerId, offer.id), eq(s.offerUses.customerId, customerId)));
      if ((used?.n ?? 0) > 0) return { valid: false as const, reason: `This customer has already used ${code}.` };
    }
  } else if (offer.firstOrderOnly || offer.oncePerCustomer || offer.excludeSegments.length) {
    return { valid: false as const, reason: `${code} can be checked once we know who the customer is.` };
  }

  const applied: AppliedOffer = {
    code: offer.code,
    title: offer.title,
    kind: offer.kind as AppliedOffer["kind"],
    value: offer.value,
    maxDiscountPaise: offer.maxDiscountPaise,
    minOrderPaise: offer.minOrderPaise,
  };
  return { valid: true as const, offer: applied, id: offer.id, says: `${offer.code}: ${offer.title} — ${describeOffer(offer)}` };
}

/** How much an offer takes off an amount, in paise. Zero below its minimum order. */
export function discountFor(offer: AppliedOffer, amountPaise: number) {
  if (offer.minOrderPaise && amountPaise < offer.minOrderPaise) return 0;
  const off = offer.kind === "percent" ? Math.round((amountPaise * offer.value) / 100) : offer.value;
  return Math.max(0, Math.min(off, offer.maxDiscountPaise ?? off, amountPaise - 100));
}

/** Counted against "once per customer" when a payment carrying it is made. */
export async function recordOfferUse(brandId: string, code: string, customerId: string | null, orderReference: string | null) {
  if (!customerId) return;
  const [offer] = await db.select({ id: s.offers.id }).from(s.offers).where(and(eq(s.offers.brandId, brandId), eq(s.offers.code, normaliseCode(code)))).limit(1);
  if (offer) await db.insert(s.offerUses).values({ offerId: offer.id, customerId, orderReference });
}

/** An offer, as a person on the team publishes it. */
export async function saveOffer(
  brandId: string,
  input: {
    code: string;
    title: string;
    kind: string;
    value: number;
    maxDiscountRupees?: number | null;
    minOrderRupees?: number | null;
    firstOrderOnly: boolean;
    oncePerCustomer: boolean;
    excludeSegments: string[];
    endsAt?: string | null;
  },
  by: string,
) {
  const code = normaliseCode(input.code);
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new Error("A code is 3–20 letters or digits, e.g. FIRST20.");
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new Error("Say what the offer is, e.g. 20% off your first order.");
  if (input.kind !== "percent" && input.kind !== "flat") throw new Error("An offer is a percentage or a flat amount off.");
  const value = Number(input.value);
  if (input.kind === "percent" && !(Number.isInteger(value) && value >= 1 && value <= 90)) throw new Error("A percentage off is between 1 and 90.");
  if (input.kind === "flat" && !(Number.isFinite(value) && value >= 1 && value <= 100_000)) throw new Error("A flat amount off is between ₹1 and ₹1,00,000.");
  const rupees = (v: number | null | undefined) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) : null);
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && isNaN(endsAt.getTime())) throw new Error("The end date is not a date.");
  const values = {
    brandId,
    code,
    title,
    kind: input.kind,
    value: input.kind === "percent" ? value : Math.round(value * 100),
    maxDiscountPaise: input.kind === "percent" ? rupees(input.maxDiscountRupees) : null,
    minOrderPaise: rupees(input.minOrderRupees),
    firstOrderOnly: Boolean(input.firstOrderOnly),
    oncePerCustomer: Boolean(input.oncePerCustomer),
    excludeSegments: input.excludeSegments.map((x) => x.trim()).filter(Boolean).slice(0, 10),
    endsAt,
    active: true,
    createdByName: by,
  };
  const [row] = await db
    .insert(s.offers)
    .values(values)
    .onConflictDoUpdate({ target: [s.offers.brandId, s.offers.code], set: { ...values, createdAt: sql`offers.created_at` } })
    .returning();
  return row;
}

export async function setOfferActive(brandId: string, offerId: string, active: boolean) {
  await db.update(s.offers).set({ active }).where(and(eq(s.offers.id, offerId), eq(s.offers.brandId, brandId)));
}
