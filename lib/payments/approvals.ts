import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";
import type { AppliedOffer } from "./offers";

/**
 * A person approves each payment link the assistant asks for — until the
 * business switches that off (Setup → Payments). And the customer proves who
 * they are first, unless the conversation already has (a WhatsApp number, a
 * real call, an email they wrote from, a code). Both on by default.
 * See docs/PAYMENTS-AND-VERIFICATION.md.
 */

export async function paymentPolicyFor(brandId: string) {
  const [row] = await db.select().from(s.paymentPolicies).where(eq(s.paymentPolicies.brandId, brandId)).limit(1);
  return { approvalRequired: row?.approvalRequired ?? true, verifyFirst: row?.verifyFirst ?? true, updatedByName: row?.updatedByName ?? null };
}

export async function savePaymentPolicy(brandId: string, policy: { approvalRequired: boolean; verifyFirst: boolean }, by: string) {
  const values = { brandId, approvalRequired: Boolean(policy.approvalRequired), verifyFirst: Boolean(policy.verifyFirst), updatedByName: by, updatedAt: new Date() };
  await db.insert(s.paymentPolicies).values(values).onConflictDoUpdate({ target: s.paymentPolicies.brandId, set: values });
}

/** The assistant asks; a person decides. One open request per order in a conversation. */
export async function requestApproval(input: {
  brandId: string;
  conversationId: string;
  customerId: string | null;
  orderReference: string;
  offer: AppliedOffer | null;
  identifiedBy: string | null;
  requestedByName: string;
}) {
  const [open] = await db
    .select()
    .from(s.paymentApprovals)
    .where(and(eq(s.paymentApprovals.conversationId, input.conversationId), eq(s.paymentApprovals.orderReference, input.orderReference), eq(s.paymentApprovals.status, "pending")))
    .limit(1);
  if (open) return open;
  const [row] = await db
    .insert(s.paymentApprovals)
    .values({ ...input, offer: input.offer as Record<string, unknown> | null })
    .returning();
  return row;
}

export async function pendingApprovals(brandId: string) {
  return db
    .select({ approval: s.paymentApprovals, customer: s.customers, channel: s.conversations.channel })
    .from(s.paymentApprovals)
    .leftJoin(s.customers, eq(s.customers.id, s.paymentApprovals.customerId))
    .leftJoin(s.conversations, eq(s.conversations.id, s.paymentApprovals.conversationId))
    .where(and(eq(s.paymentApprovals.brandId, brandId), eq(s.paymentApprovals.status, "pending")))
    .orderBy(desc(s.paymentApprovals.createdAt));
}

/**
 * Say something to the customer where the conversation is: on WhatsApp it
 * reaches their phone, on an email thread it is emailed, in a website chat it
 * appears in the chat. Always on the transcript.
 */
export async function tellCustomer(conversationId: string, text: string, by: string) {
  const [conversation] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conversation) return { delivered: false };
  let delivered = true;
  try {
    if (conversation.channel === "whatsapp") {
      const { deliverHumanReply } = await import("@/lib/whatsapp/cloud");
      await deliverHumanReply(conversation, text);
    } else if (conversation.channel === "email") {
      const [brand] = await db.select().from(s.brands).where(eq(s.brands.id, conversation.brandId)).limit(1);
      const { sendOnThread } = await import("@/lib/email/inbound");
      await sendOnThread(conversationId, { id: brand.id, name: brand.name, slug: brand.slug }, text);
    } else if (conversation.channel === "phone") {
      // The call is over; the business's system sends the link by SMS and email.
      delivered = false;
    }
  } catch (e) {
    console.error("[payments] telling the customer", (e as Error).message);
    delivered = false;
  }
  const [last] = await db.select({ ordinal: s.turns.ordinal }).from(s.turns).where(eq(s.turns.conversationId, conversationId)).orderBy(desc(s.turns.ordinal)).limit(1);
  await db.insert(s.turns).values({ conversationId, ordinal: (last?.ordinal ?? -1) + 1, speaker: "human", authorName: by, body: text });
  return { delivered };
}

/** Approve: the link is made (by the business's system, or by Corva) and sent. Decline: the customer is told the team will be in touch. */
export async function decideApproval(brandId: string, approvalId: string, approve: boolean, by: string) {
  const [approval] = await db
    .select()
    .from(s.paymentApprovals)
    .where(and(eq(s.paymentApprovals.id, approvalId), eq(s.paymentApprovals.brandId, brandId)))
    .limit(1);
  if (!approval) throw new Error("No such payment request.");
  if (approval.status !== "pending") throw new Error(`This request was already ${approval.status}.`);

  if (!approve) {
    await db.update(s.paymentApprovals).set({ status: "declined", decidedByName: by, decidedAt: new Date() }).where(eq(s.paymentApprovals.id, approvalId));
    if (approval.conversationId) await tellCustomer(approval.conversationId, "Thank you for waiting. Someone from the team will be in touch with you about the payment.", by);
    return { status: "declined" as const };
  }

  const { askForPayment, PaymentError } = await import("./index");
  const offer = (approval.offer ?? null) as AppliedOffer | null;
  let payment;
  try {
    payment = await askForPayment({
      brandId,
      conversationId: approval.conversationId,
      customerId: approval.customerId,
      orderReference: approval.orderReference,
      requestedByName: `${approval.requestedByName}, approved by ${by}`,
      byAi: true,
      notify: true,
      offer,
    });
  } catch (e) {
    const reason = e instanceof PaymentError ? e.message : "The payment link could not be made.";
    await db.update(s.paymentApprovals).set({ status: "failed", decidedByName: by, decidedAt: new Date(), error: reason }).where(eq(s.paymentApprovals.id, approvalId));
    throw new Error(reason);
  }
  if (offer) {
    const { recordOfferUse } = await import("./offers");
    await recordOfferUse(brandId, offer.code, approval.customerId ?? payment.customerId, approval.orderReference);
  }
  await db.update(s.paymentApprovals).set({ status: "approved", decidedByName: by, decidedAt: new Date(), paymentId: payment.id }).where(eq(s.paymentApprovals.id, approvalId));
  if (approval.conversationId && payment.url) {
    const text = `Here is the link to pay ${formatRupees(payment.amountPaise, { decimals: "auto" })}${payment.description ? ` for ${payment.description}` : ""}: ${payment.url}`;
    await tellCustomer(approval.conversationId, text, by);
  }
  return { status: "approved" as const, payment };
}
