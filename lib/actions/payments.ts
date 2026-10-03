"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";
import { PaymentError, askForPayment, paymentJson, removePaymentEndpoint, savePaymentEndpoint } from "@/lib/payments";
import { deliverHumanReply } from "@/lib/whatsapp/cloud";
import { sendSms } from "@/lib/sms";
import { audit } from "./audit";
import { decideApproval, savePaymentPolicy } from "@/lib/payments/approvals";
import { saveOffer, setOfferActive } from "@/lib/payments/offers";

/** Where this business makes payment links. Returns the signing secret, shown once. */
export async function connectPaymentEndpoint(url: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const saved = await savePaymentEndpoint(brand.id, url, session.name);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "payments.endpoint_set", target: saved.url });
  revalidatePath("/app/setup");
  return saved;
}

export async function disconnectPaymentEndpoint() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await removePaymentEndpoint(brand.id);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "payments.endpoint_removed", target: brand.name });
  revalidatePath("/app/setup");
}

/**
 * Ask the customer in this conversation to pay.
 *
 * A person may name the amount, or give an order reference and let the
 * business work out what is owed. With `send`, the link is posted into the
 * conversation and, on WhatsApp, reaches the customer's phone.
 */
export async function requestConversationPayment(
  conversationId: string,
  input: { amountRupees?: string; orderReference?: string; description?: string; send: boolean; sms?: boolean },
) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });
  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.brandId, brand.id)))
    .limit(1);
  if (!conversation) throw new Error("No such conversation.");

  const typed = input.amountRupees?.replace(/[₹,\s]/g, "") ?? "";
  if (typed && !/^\d+(\.\d{1,2})?$/.test(typed)) throw new Error("The amount must be a number of rupees, like 300 or 99.50.");
  const orderReference = input.orderReference?.trim() || null;
  if (!typed && !orderReference) throw new Error("Give an amount or an order reference.");

  let payment;
  try {
    payment = await askForPayment({
      brandId: brand.id,
      conversationId,
      customerId: conversation.customerId,
      orderReference,
      amountPaise: typed ? Math.round(Number(typed) * 100) : null,
      description: input.description?.trim() || null,
      requestedByName: session.name,
      byAi: false,
    });
  } catch (e) {
    if (e instanceof PaymentError) throw new Error(e.message);
    throw e;
  }

  if (input.send && payment.url) {
    const text = `Here is the link to pay ${formatRupees(payment.amountPaise, { decimals: "auto" })}${payment.description ? ` for ${payment.description}` : ""}: ${payment.url}`;
    await deliverHumanReply(conversation, text);
    const [last] = await db.select({ ordinal: s.turns.ordinal }).from(s.turns).where(eq(s.turns.conversationId, conversationId)).orderBy(desc(s.turns.ordinal)).limit(1);
    await db.insert(s.turns).values({ conversationId, ordinal: (last?.ordinal ?? -1) + 1, speaker: "human", authorName: session.name, body: text });
  }

  // By SMS as well, when asked and the business sends SMS (a template; see lib/sms).
  let smsNote: string | null = null;
  if (input.sms && payment.url) {
    const [customer] = conversation.customerId ? await db.select().from(s.customers).where(eq(s.customers.id, conversation.customerId)).limit(1) : [];
    const sent = await sendSms({
      brandId: brand.id,
      purpose: "payment_link",
      to: customer?.phone,
      vars: [customer?.name?.split(" ")[0] ?? "Customer", formatRupees(payment.amountPaise, { decimals: "auto" }).replace("₹", "Rs "), payment.description ?? "your order", payment.url, brand.name],
      customerId: conversation.customerId,
      conversationId,
      sentByName: session.name,
    });
    smsNote = sent.sent ? "Sent by SMS." : `Not sent by SMS: ${sent.reason}.`;
  }

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "payment.requested",
    target: payment.reference,
    meta: { amountPaise: payment.amountPaise, conversationId },
  });
  revalidatePath("/app/conversations");
  return { ...paymentJson(payment), smsNote };
}

/* ─── The assistant and payment (docs/PAYMENTS-AND-VERIFICATION.md) ────── */

/** Whether a person approves each AI payment link, and whether customers prove who they are first. */
export async function savePaymentPolicyAction(policy: { approvalRequired: boolean; verifyFirst: boolean }) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await savePaymentPolicy(brand.id, policy, session.name);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "payments.policy", target: brand.name, meta: policy });
  revalidatePath("/app/setup");
}

/** Publish an offer — the only kind of discount the AI may give. */
export async function saveOfferAction(input: Parameters<typeof saveOffer>[1]) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const row = await saveOffer(brand.id, input, session.name);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "offers.saved", target: row.code, meta: { kind: row.kind, value: row.value } });
  revalidatePath("/app/setup");
}

export async function setOfferActiveAction(offerId: string, active: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await setOfferActive(brand.id, offerId, active);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: active ? "offers.resumed" : "offers.paused", target: offerId });
  revalidatePath("/app/setup");
}

/** A person's call on a payment link the AI asked for. */
export async function decidePaymentApproval(approvalId: string, approve: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });
  const result = await decideApproval(brand.id, approvalId, approve, session.name);
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: approve ? "payments.approved" : "payments.declined",
    target: approvalId,
    meta: result.status === "approved" ? { amountPaise: result.payment.amountPaise, reference: result.payment.reference } : {},
  });
  revalidatePath("/app/handoffs");
  return { status: result.status, amount: result.status === "approved" ? formatRupees(result.payment.amountPaise, { decimals: "auto" }) : undefined };
}
