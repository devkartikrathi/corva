"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { loadAgentConfig } from "@/lib/agent/config";
import { respond } from "@/lib/agent/respond";
import { classifyAndStore } from "@/lib/pipelines/classify";
import { customerForCaller } from "@/lib/crm/capture";

/**
 * Chatting to a business as a customer would.
 *
 * The text twin of the dialer, for when a microphone is not an option — a
 * demo in a loud room, or checking a knowledge change quickly. It runs the
 * same `respond()` a real web chat runs, so the leads, follow-ups and
 * handoffs it produces are the real thing, and they appear on the business's
 * console as the conversation happens.
 *
 * Staff only: it can reach any business, which no tenant should be able to.
 */

function refresh(conversationId: string) {
  revalidatePath("/app");
  revalidatePath("/app/live");
  revalidatePath("/app/leads");
  revalidatePath("/app/follow-ups");
  revalidatePath(`/app/conversations`);
  void conversationId;
}

export async function startTestChat(input: { brandId: string; callerPhone: string; countsInMetrics: boolean }) {
  await requireStaff();
  const config = await loadAgentConfig(input.brandId);
  if (!config) throw new Error("That business has no AI assistant set up.");

  const customer = await customerForCaller(input.brandId, input.callerPhone);
  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: input.brandId,
      customerId: customer?.id ?? null,
      channel: "web_chat",
      status: "live",
      isTest: !input.countsInMetrics,
      agentVersionId: config.versionId,
      startedAt: new Date(),
    })
    .returning();
  refresh(conversation.id);
  return {
    conversationId: conversation.id,
    agentName: config.agentName,
    business: config.brandName,
    recognised: customer && !/^\+?[\d\s()-]{7,}$/.test(customer.name) ? customer.name : null,
  };
}

export async function sendTestChat(conversationId: string, message: string) {
  await requireStaff();
  const text = message.trim();
  if (!text) throw new Error("Type something first.");

  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error("That chat has ended.");
  if (conversation.status === "resolved" || conversation.status === "abandoned") {
    throw new Error("That chat has ended. Start a new one.");
  }
  // A person who has taken over is the one replying now.
  if (conversation.handledBy) {
    await db.insert(s.turns).values({
      conversationId,
      ordinal: await nextOrdinal(conversationId),
      speaker: "customer",
      body: text,
    });
    refresh(conversationId);
    return { text: null, heldBy: conversation.handledBy, actions: [], escalation: null, closed: false };
  }

  const reply = await respond({ conversationId, message: text });
  refresh(conversationId);
  return {
    text: reply.text,
    heldBy: null,
    actions: reply.actions,
    escalation: reply.escalation ? { reason: reply.escalation.reason, routedTo: reply.escalation.routedTo } : null,
    closed: Boolean(reply.closure),
  };
}

/** What a person on the console has typed since `afterOrdinal`, for a held chat. */
export async function pollTestChat(conversationId: string, afterOrdinal: number) {
  await requireStaff();
  const rows = await db
    .select({ ordinal: s.turns.ordinal, speaker: s.turns.speaker, author: s.turns.authorName, body: s.turns.body })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(s.turns.ordinal);
  const [c] = await db
    .select({ handledBy: s.conversations.handledBy, status: s.conversations.status })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  return {
    turns: rows.filter((r) => r.ordinal > afterOrdinal && (r.speaker === "human" || r.speaker === "system")),
    lastOrdinal: rows.at(-1)?.ordinal ?? -1,
    heldBy: c?.handledBy ?? null,
    ended: c ? c.status === "resolved" || c.status === "abandoned" : true,
  };
}

export async function endTestChat(conversationId: string) {
  await requireStaff();
  const [c] = await db
    .update(s.conversations)
    .set({ status: "resolved", endedAt: new Date() })
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.status, "live")))
    .returning({ id: s.conversations.id });
  // Name it from its transcript, as the voice bridge does after a call.
  if (c) void classifyAndStore(conversationId).catch(() => undefined);
  refresh(conversationId);
}

async function nextOrdinal(conversationId: string) {
  const rows = await db
    .select({ ordinal: s.turns.ordinal })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId));
  return rows.reduce((m, r) => Math.max(m, r.ordinal), -1) + 1;
}
