import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { candidatesFor } from "@/lib/agent/routing";
import { isUnnamed, scheduleFollowUp } from "./capture";
import { sendSms } from "@/lib/sms";

/**
 * When the customer asks for a person and no person can come.
 *
 * Asking for a human is the moment a customer is most likely to be let down:
 * told "connecting you now", then left holding while nobody picks up. So the
 * assistant checks first whether anyone on the team is marked available, and
 * if nobody is — or nobody picks up within a minute — it stops promising a
 * transfer and promises a callback instead. That promise is a follow-up with
 * an owner and a time, so it lands in somebody's list rather than in the air.
 */

/** Whether anyone who may take a customer is marked available right now. */
export async function anyoneFree(brandId: string) {
  const [brand] = await db.select({ orgId: s.brands.orgId }).from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
  if (!brand) return false;
  return (await candidatesFor(brand.orgId, brandId)).some((c) => c.availability === "available");
}

/** How soon "as soon as possible" is, for the follow-up's due time. */
const CALLBACK_WITHIN_MS = 15 * 60_000;

/**
 * Write the callback a customer was just promised.
 *
 * Given to whoever the handoff was ringing, if anyone, since they were already
 * the right person; otherwise to the account owner or the lightest-loaded
 * colleague, as any follow-up is. Written once per handoff.
 */
export async function arrangeCallback(opts: {
  conversationId: string;
  brandId: string;
  handoffId: string | null;
  reason: string;
  agentName: string;
}) {
  const [row] = await db
    .select({ conversation: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, opts.conversationId))
    .limit(1);
  const [handoff] = opts.handoffId
    ? await db.select().from(s.handoffs).where(eq(s.handoffs.id, opts.handoffId)).limit(1)
    : [];

  const who = row?.customer && !isUnnamed(row.customer.name) ? row.customer.name : null;
  const result = await scheduleFollowUp({
    conversationId: opts.conversationId,
    brandId: opts.brandId,
    customerId: row?.conversation.customerId ?? null,
    title: `Call back${who ? ` ${who}` : ""}: asked for a person, nobody was free`,
    detail: [handoff?.headline, `Why they asked: ${opts.reason}`].filter(Boolean).join("\n"),
    due: new Date(Date.now() + CALLBACK_WITHIN_MS).toISOString(),
    createdByName: opts.agentName,
    createdByAi: true,
    assigneeMembershipId: handoff?.routedToMembershipId ?? null,
  });
  // In writing too, where the business sends SMS: the promise is then on the
  // customer's phone, not only in what they heard.
  const [brand] = await db.select({ name: s.brands.name }).from(s.brands).where(eq(s.brands.id, opts.brandId)).limit(1);
  await sendSms({
    brandId: opts.brandId,
    purpose: "callback_arranged",
    to: row?.customer?.phone,
    vars: [result.assigneeName?.split(" ")[0] ?? "Our team", opts.reason, brand?.name ?? ""],
    customerId: row?.conversation.customerId ?? null,
    conversationId: opts.conversationId,
    sentByName: opts.agentName,
  }).catch((e) => console.error("[sms] callback", (e as Error).message));
  return {
    assigneeName: result.assigneeName,
    when: result.dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }),
  };
}

/** True while nobody has taken the handoff. */
export async function isUnanswered(handoffId: string) {
  const [handoff] = await db.select({ status: s.handoffs.status }).from(s.handoffs).where(eq(s.handoffs.id, handoffId)).limit(1);
  return handoff?.status === "waiting" || handoff?.status === "reassigned";
}

/**
 * Close a handoff nobody took, once the customer is no longer waiting on it.
 *
 * Left open while the customer is still there, so a colleague who frees up
 * can still join. Once they have gone the callback is the work, and an alert
 * for a customer who is not there would only send someone to an empty line.
 */
export async function settleUnanswered(handoffId: string) {
  const [handoff] = await db
    .update(s.handoffs)
    .set({ status: "resolved", resolution: "Nobody was free — callback arranged" })
    .where(and(eq(s.handoffs.id, handoffId), inArray(s.handoffs.status, ["waiting", "reassigned"])))
    .returning({ conversationId: s.handoffs.conversationId });
  if (!handoff) return false;
  await db
    .update(s.conversations)
    .set({ status: "resolved" })
    .where(and(eq(s.conversations.id, handoff.conversationId), eq(s.conversations.status, "waiting_human")));
  return true;
}
