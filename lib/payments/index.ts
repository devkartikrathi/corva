import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isVerified } from "@/lib/crm/identity";
import { paymentPolicyFor, requestApproval } from "./approvals";
import { checkOffer, recordOfferUse, type AppliedOffer } from "./offers";
import { refreshProfile } from "@/lib/crm/profile";
import * as s from "@/lib/db/schema";
import { customerForCaller, isUnnamed } from "@/lib/crm/capture";
import { ApiError } from "@/lib/integrations/api";
import { sign, webhookUrl } from "@/lib/integrations/webhooks";
import { formatRupees } from "@/lib/money";
import { CollectionError, collectForBusiness, collectionFor } from "./hosted";

/**
 * Collecting money from a business's customers.
 *
 * The money is the business's. It has its own payment account (Tumble Days:
 * Razorpay) and its own books, so Corva never holds a payment key. What Corva
 * adds is reach: the team in the console and the assistant on a chat,
 * WhatsApp or a call can ask a customer to pay, and everyone sees when they
 * have.
 *
 *   ask   — `askForPayment` calls the business's payment endpoint, signed
 *           like a webhook, and gets a link back (plus a page and a QR).
 *   hear  — the business reports every change to POST /api/v1/payments
 *           (`recordPayment`): the customer's record shows it, the
 *           conversation it was asked in says "received", and on WhatsApp
 *           the customer is thanked.
 *
 * The amount is never the assistant's: it asks for an order's link and the
 * business works out what is owed. A person in the console may name a figure.
 * Not a server action module: anything exported from "use server" is public.
 */

type Brand = typeof s.brands.$inferSelect;
export type CustomerPayment = typeof s.customerPayments.$inferSelect;

const STATUSES = ["pending", "partially_paid", "paid", "expired", "cancelled", "failed"] as const;
type Status = (typeof STATUSES)[number];
/** Statuses only climb, so a late or repeated report never undoes a payment. */
const RANK: Record<Status, number> = { failed: 0, pending: 1, cancelled: 2, expired: 2, partially_paid: 3, paid: 4 };

const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const newPaymentSecret = () => `cps_${randomBytes(24).toString("base64url")}`;

export async function paymentEndpointFor(brandId: string) {
  const [row] = await db.select().from(s.paymentEndpoints).where(eq(s.paymentEndpoints.brandId, brandId)).limit(1);
  return row ?? null;
}

/** Set (or replace) where this business makes payment links. Returns the new secret, shown once. */
export async function savePaymentEndpoint(brandId: string, url: string, by: string) {
  const checked = webhookUrl(url);
  const secret = newPaymentSecret();
  await db
    .insert(s.paymentEndpoints)
    .values({ brandId, url: checked, secret, createdByName: by })
    .onConflictDoUpdate({
      target: s.paymentEndpoints.brandId,
      set: { url: checked, secret, createdByName: by, createdAt: new Date(), lastCalledAt: null, lastStatus: null, lastError: null },
    });
  return { url: checked, secret };
}

export async function removePaymentEndpoint(brandId: string) {
  await db.delete(s.paymentEndpoints).where(eq(s.paymentEndpoints.brandId, brandId));
}

/** A payment as the console and the assistant read it. */
export function paymentJson(p: CustomerPayment) {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    amountRupees: p.amountPaise / 100,
    amountPaidRupees: p.amountPaidPaise / 100,
    description: p.description,
    url: p.url,
    pageUrl: p.pageUrl,
    qrUrl: p.qrUrl,
    method: p.method,
    orderReference: p.orderReference,
    customerId: p.customerId,
    conversationId: p.conversationId,
    requestedBy: p.requestedByName,
    paidAt: p.paidAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export class PaymentError extends Error {}

/**
 * How this business takes payment, if at all: its own system (an endpoint),
 * or Corva's account on its behalf. Its own system wins when it has both.
 */
export async function paymentRoute(brandId: string): Promise<"endpoint" | "corva" | null> {
  if (await paymentEndpointFor(brandId)) return "endpoint";
  if (await collectionFor(brandId)) return "corva";
  return null;
}

/**
 * Ask the business for a payment link.
 *
 * `amountPaise` only from a person. The assistant passes an order reference
 * and the business decides the figure — or refuses, in words the assistant
 * can repeat ("There is no bill on this order yet").
 */
export async function askForPayment(input: {
  brandId: string;
  conversationId?: string | null;
  customerId?: string | null;
  orderReference?: string | null;
  amountPaise?: number | null;
  description?: string | null;
  requestedByName: string;
  byAi: boolean;
  /** Have the business's provider also send the link by SMS / email. */
  notify?: boolean;
  /** A published offer, already checked (lib/payments/offers.ts): applied by Corva, or by the business's system. */
  offer?: AppliedOffer | null;
}): Promise<CustomerPayment> {
  if (input.byAi && input.amountPaise != null) throw new PaymentError("The assistant cannot name an amount; ask for an order's payment instead.");
  if (!input.orderReference && input.amountPaise == null) throw new PaymentError("Give an order reference or an amount.");
  const endpoint = await paymentEndpointFor(input.brandId);
  if (!endpoint) {
    // No system of its own: Corva collects on its behalf, if that is switched on.
    if (!(await collectionFor(input.brandId))) throw new PaymentError("This business has not set up payments yet.");
    try {
      return await collectForBusiness({
        brandId: input.brandId,
        conversationId: input.conversationId ?? null,
        customerId: input.customerId ?? null,
        orderReference: input.orderReference ?? null,
        amountPaise: input.amountPaise ?? null,
        description: input.description ?? null,
        requestedByName: input.requestedByName,
        byAi: input.byAi,
        offer: input.offer ?? null,
      });
    } catch (e) {
      if (e instanceof CollectionError) throw new PaymentError(e.message);
      throw e;
    }
  }

  const [customer] = input.customerId
    ? await db.select().from(s.customers).where(and(eq(s.customers.id, input.customerId), eq(s.customers.brandId, input.brandId))).limit(1)
    : [];
  const requestId = `cpr_${randomBytes(12).toString("hex")}`;
  const body = JSON.stringify({
    requestId,
    orderReference: input.orderReference ?? undefined,
    amountRupees: input.amountPaise != null ? input.amountPaise / 100 : undefined,
    description: input.description ?? undefined,
    customer: customer
      ? { id: customer.id, name: isUnnamed(customer.name) ? undefined : customer.name, phone: customer.phone ?? undefined, email: customer.email ?? undefined }
      : undefined,
    conversationId: input.conversationId ?? undefined,
    requestedBy: input.requestedByName,
    notify: input.notify !== false,
    // A published offer Corva has checked for this customer; the business's system applies it.
    offer: input.offer
      ? {
          code: input.offer.code,
          title: input.offer.title,
          kind: input.offer.kind,
          value: input.offer.kind === "percent" ? input.offer.value : input.offer.value / 100,
          maxDiscountRupees: input.offer.maxDiscountPaise != null ? input.offer.maxDiscountPaise / 100 : undefined,
          minOrderRupees: input.offer.minOrderPaise != null ? input.offer.minOrderPaise / 100 : undefined,
        }
      : undefined,
  });

  const t = Math.floor(Date.now() / 1000);
  let status = 0;
  let reply: Record<string, unknown> | null = null;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Corva-Payments/1", "corva-signature": `t=${t},v1=${sign(endpoint.secret, t, body)}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    reply = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch (e) {
    reply = { error: (e as Error).name === "TimeoutError" ? "The business's payment system did not answer in time." : "The business's payment system could not be reached." };
  }
  const ok = status >= 200 && status < 300 && reply && typeof reply.reference === "string";
  await db
    .update(s.paymentEndpoints)
    .set({ lastCalledAt: new Date(), lastStatus: status, lastError: ok ? null : String(reply?.error ?? `answered ${status}`).slice(0, 300) })
    .where(eq(s.paymentEndpoints.brandId, input.brandId));
  if (!ok) throw new PaymentError(String(reply?.error ?? "The payment link could not be made.").slice(0, 300));

  const brand = { id: input.brandId } as Brand;
  const { payment } = await recordPayment(brand, reply!, { conversationId: input.conversationId ?? null, customerId: customer?.id ?? null, byAi: input.byAi, requestedByName: input.requestedByName });
  return payment;
}

async function convertLead(p: CustomerPayment) {
  const open = sql`${s.leads.stage} in ('new','contacted','qualified','proposal')`;
  const [lead] = p.conversationId
    ? await db.select({ id: s.leads.id }).from(s.leads).where(and(eq(s.leads.conversationId, p.conversationId), open)).limit(1)
    : [];
  const [fallback] =
    !lead && p.customerId
      ? await db.select({ id: s.leads.id }).from(s.leads).where(and(eq(s.leads.customerId, p.customerId), open)).orderBy(desc(s.leads.createdAt)).limit(1)
      : [];
  const id = lead?.id ?? fallback?.id;
  if (!id) return;
  await db.update(s.leads).set({ stage: "won", stageChangedAt: new Date(), updatedAt: new Date() }).where(eq(s.leads.id, id));
}

/** The customer a reported payment belongs to, if it can be told. */
async function customerFor(brandId: string, c: { id?: unknown; phone?: unknown; name?: unknown } | undefined) {
  if (typeof c?.id === "string" && UUID.test(c.id)) {
    const [row] = await db.select({ id: s.customers.id }).from(s.customers).where(and(eq(s.customers.id, c.id), eq(s.customers.brandId, brandId))).limit(1);
    if (row) return row.id;
  }
  const phone = clip(c?.phone, 30);
  if (phone) return (await customerForCaller(brandId, phone, { verified: true, source: "business" }))?.id ?? null;
  return null;
}

const date = (v: unknown) => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new ApiError(400, "Dates must be ISO 8601.");
  return d;
};
const rupees = (v: unknown, field: string) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${field} must be a number of rupees.`);
  return Math.round(n * 100);
};

/**
 * POST /api/v1/payments — where a payment stands, as the business sees it.
 *
 * Sent on every change; the same `reference` replaces what was there, and a
 * status never moves backwards. Also how a link Corva asked for is recorded.
 */
export async function recordPayment(
  brand: Pick<Brand, "id">,
  input: Record<string, unknown>,
  asked?: { conversationId: string | null; customerId: string | null; byAi: boolean; requestedByName: string },
) {
  const reference = clip(input.reference, 60);
  if (!reference) throw new ApiError(400, "reference is required — the payment's id in your system.");
  const status = (clip(input.status, 20) ?? "pending") as Status;
  if (!STATUSES.includes(status)) throw new ApiError(400, `status must be one of: ${STATUSES.join(", ")}.`);
  const amountPaise = rupees(input.amountRupees, "amountRupees");
  const paidPaise = rupees(input.amountPaidRupees, "amountPaidRupees");

  const requestId = clip(input.requestId, 100);
  const [existing] = await db
    .select()
    .from(s.customerPayments)
    .where(and(eq(s.customerPayments.brandId, brand.id), eq(s.customerPayments.reference, reference)))
    .limit(1);
  const [asking] = !existing && requestId ? await db.select().from(s.customerPayments).where(eq(s.customerPayments.requestId, requestId)).limit(1) : [];
  const current = existing ?? asking;

  // The conversation it was asked in: ours if Corva asked, else the one named, if it is this business's.
  let conversationId = current?.conversationId ?? asked?.conversationId ?? null;
  const named = clip(input.conversationId, 40);
  if (!conversationId && named && UUID.test(named)) {
    const [c] = await db.select({ id: s.conversations.id }).from(s.conversations).where(and(eq(s.conversations.id, named), eq(s.conversations.brandId, brand.id))).limit(1);
    conversationId = c?.id ?? null;
  }
  let customerId = current?.customerId ?? asked?.customerId ?? (await customerFor(brand.id, input.customer as never));
  if (!customerId && conversationId) {
    const [c] = await db.select({ customerId: s.conversations.customerId }).from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
    customerId = c?.customerId ?? null;
  }

  const fields = {
    description: clip(input.description, 500),
    url: clip(input.url, 500),
    pageUrl: clip(input.pageUrl, 500),
    qrUrl: clip(input.qrUrl, 500),
    method: clip(input.method, 40),
    orderReference: clip(input.orderReference, 60),
    expiresAt: date(input.expiresAt),
  };

  if (!current) {
    if (amountPaise == null) throw new ApiError(400, "amountRupees is required the first time a payment is sent.");
    const [row] = await db
      .insert(s.customerPayments)
      .values({
        brandId: brand.id,
        customerId,
        conversationId,
        requestId,
        reference,
        status,
        amountPaise,
        amountPaidPaise: paidPaise ?? 0,
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)),
        requestedByName: asked?.requestedByName ?? clip(input.requestedBy, 120),
        requestedByAi: asked?.byAi ?? false,
        paidAt: status === "paid" ? (date(input.paidAt) ?? new Date()) : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return recordPayment(brand, input, asked); // raced with the same report: apply it as an update
    if (status === "paid") await announcePaid(row);
    return { payment: row, created: true };
  }

  const prev = current.status as Status;
  const climbs = RANK[status] >= RANK[prev];
  const becamePaid = status === "paid" && prev !== "paid";
  const [row] = await db
    .update(s.customerPayments)
    .set({
      reference,
      ...(climbs ? { status } : {}),
      ...(amountPaise != null && prev === "pending" ? { amountPaise } : {}),
      amountPaidPaise: Math.max(paidPaise ?? 0, current.amountPaidPaise),
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)),
      customerId: current.customerId ?? customerId,
      conversationId: current.conversationId ?? conversationId,
      paidAt: becamePaid ? (date(input.paidAt) ?? new Date()) : current.paidAt,
      updatedAt: new Date(),
    })
    .where(eq(s.customerPayments.id, current.id))
    .returning();
  if (becamePaid && climbs) await announcePaid(row);
  return { payment: row, created: false };
}

/**
 * Money came in: say so where it was asked for.
 *
 * A line in the conversation for the team, and on WhatsApp a thank-you to
 * the customer — the chat it was asked in is the natural place for it.
 * Best-effort: the payment is recorded whatever happens here.
 */
async function announcePaid(p: CustomerPayment) {
  // Paid is converted: the lead this payment was for (its conversation's, else
  // the customer's open one) moves to Converted.
  await convertLead(p).catch((e) => console.error("[payments] lead", (e as Error).message));
  // What they have paid is part of who they are to the business.
  if (p.customerId) await refreshProfile(p.customerId).catch((e) => console.error("[payments] profile", (e as Error).message));
  if (!p.conversationId) return;
  try {
    const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, p.conversationId)).limit(1);
    if (!conversation) return;
    const [last] = await db
      .select({ ordinal: s.turns.ordinal })
      .from(s.turns)
      .where(eq(s.turns.conversationId, conversation.id))
      .orderBy(desc(s.turns.ordinal))
      .limit(1);
    const how = p.method ? ` by ${p.method.toUpperCase()}` : "";
    await db.insert(s.turns).values({
      conversationId: conversation.id,
      ordinal: (last?.ordinal ?? -1) + 1,
      speaker: "system",
      body: `Payment received: ${formatRupees(p.amountPaidPaise || p.amountPaise, { decimals: "auto" })}${how} (${p.reference}).`,
    });
    if (conversation.channel === "whatsapp") {
      // Loaded here: the WhatsApp module reaches the agent, which reaches this one.
      const { deliverHumanReply } = await import("@/lib/whatsapp/cloud");
      await deliverHumanReply(conversation, `Thank you — we have received your payment of ${formatRupees(p.amountPaidPaise || p.amountPaise, { decimals: "auto" })} (${p.reference}).`);
    }
  } catch (e) {
    console.error("[payments] announcing", p.reference, (e as Error).message);
  }
}

/** Payments asked for in one conversation, newest first. */
export function paymentsInConversation(conversationId: string) {
  return db.select().from(s.customerPayments).where(eq(s.customerPayments.conversationId, conversationId)).orderBy(desc(s.customerPayments.createdAt));
}

/** A customer's recent payments, for the console and the assistant. */
export function paymentsFor(customerId: string, limit = 10) {
  return db.select().from(s.customerPayments).where(eq(s.customerPayments.customerId, customerId)).orderBy(desc(s.customerPayments.createdAt)).limit(limit);
}

/** One line per recent payment, for what the assistant knows about the customer. */
export async function paymentsContext(customerId: string | null) {
  if (!customerId) return null;
  const rows = await paymentsFor(customerId, 5);
  if (!rows.length) return null;
  return rows
    .map((p) => {
      const amount = formatRupees(p.amountPaise, { decimals: "auto" });
      const what = p.orderReference ? ` for ${p.orderReference}` : p.description ? ` for ${p.description}` : "";
      const state =
        p.status === "paid"
          ? `paid${p.paidAt ? ` on ${p.paidAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` : ""}`
          : p.status === "pending"
            ? `awaiting payment — link ${p.url ?? p.pageUrl ?? "sent"}`
            : p.status.replace("_", " ");
      return `- ${p.reference}: ${amount}${what}, ${state}`;
    })
    .join("\n");
}

/**
 * The assistant's request_payment tool, on every channel.
 *
 * It names an order, never a figure: the business works out what is owed and
 * the assistant quotes what comes back. A refusal ("no bill on this order
 * yet") comes back as words it can repeat, not as an error.
 */
export async function requestPaymentForAssistant(opts: { brandId: string; conversationId: string; orderReference: string; agentName: string; offerCode?: string | null }) {
  const [conversation] = await db
    .select({ customerId: s.conversations.customerId, identifiedBy: s.conversations.identifiedBy })
    .from(s.conversations)
    .where(eq(s.conversations.id, opts.conversationId))
    .limit(1);
  const orderReference = opts.orderReference.trim().slice(0, 60);
  const policy = await paymentPolicyFor(opts.brandId);

  // Who they are, proven, before any money is asked for.
  if (policy.verifyFirst && !isVerified(conversation?.identifiedBy)) {
    return {
      made: false as const,
      response: {
        made: false,
        needsVerification: true,
        reason: "First the customer must prove who they are: call send_verification_code, then verify_code with the code they type, then ask for the payment again.",
      },
    };
  }

  // A discount only ever comes from a published offer, checked here.
  let offer: AppliedOffer | null = null;
  if (opts.offerCode?.trim()) {
    const check = await checkOffer(opts.brandId, conversation?.customerId ?? null, opts.offerCode);
    if (!check.valid) return { made: false as const, response: { made: false, reason: check.reason } };
    offer = check.offer;
  }

  // A person approves the link before it exists.
  if (policy.approvalRequired) {
    const approval = await requestApproval({
      brandId: opts.brandId,
      conversationId: opts.conversationId,
      customerId: conversation?.customerId ?? null,
      orderReference,
      offer,
      identifiedBy: conversation?.identifiedBy ?? null,
      requestedByName: `${opts.agentName} (AI)`,
    });
    return {
      made: false as const,
      awaitingApproval: approval.id,
      response: {
        made: false,
        awaitingApproval: true,
        say:
          "The team checks each payment link before it is sent. Tell the customer the link will reach them here (and by SMS or email) " +
          "as soon as the team has confirmed it. Do not state an amount.",
      },
    };
  }

  try {
    const p = await askForPayment({
      brandId: opts.brandId,
      conversationId: opts.conversationId,
      customerId: conversation?.customerId ?? null,
      orderReference,
      requestedByName: `${opts.agentName} (AI)`,
      byAi: true,
      notify: true,
      offer,
    });
    if (offer) await recordOfferUse(opts.brandId, offer.code, p.customerId ?? conversation?.customerId ?? null, orderReference);
    return {
      made: true as const,
      payment: p,
      response: {
        made: true,
        amount: formatRupees(p.amountPaise, { decimals: "auto" }),
        link: p.url,
        reference: p.reference,
        forWhat: p.description,
        ...(offer ? { offer: `${offer.code} was sent with the request; the amount above is what the business's system charged.` } : {}),
        note: "The business has also sent the link to the customer's phone by SMS where it has their number.",
      },
    };
  } catch (e) {
    const reason = e instanceof PaymentError || e instanceof ApiError ? e.message : "The payment link could not be made just now.";
    if (!(e instanceof PaymentError)) console.error("[payments] assistant request", (e as Error).message);
    return { made: false as const, response: { made: false, reason } };
  }
}
