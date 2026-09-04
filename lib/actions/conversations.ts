"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { respond } from "@/lib/agent/respond";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";
import { billConversation } from "@/lib/agent/respond";

/**
 * Everything a person can do to a conversation.
 *
 * The design's claim is that a human can step into a call at any point and the
 * AI gets out of the way cleanly — so taking the line is a real state change
 * with a turn in the transcript, not a UI mode. Whoever reads the transcript
 * afterwards should be able to see exactly where the handover happened and
 * who was speaking on either side of it.
 *
 * Every function re-derives the session and checks the capability. A server
 * action is a public POST endpoint; the button that called it proves nothing.
 */

/** Load a conversation, or refuse if it belongs to another brand. */
async function scoped(conversationId: string, brandId: string) {
  const [row] = await db
    .select()
    .from(s.conversations)
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("No such conversation in this brand.");
  return row;
}

const nextOrdinal = async (conversationId: string) => {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${s.turns.ordinal}), -1) + 1` })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId));
  return Number(row.n);
};

/** Seconds since the call started, for the transcript's "04:12" gutter. */
const offset = (startedAt: Date) => Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));

function refreshConversationScreens(conversationId: string) {
  revalidatePath("/app");
  revalidatePath("/app/live");
  revalidatePath("/app/handoffs");
  revalidatePath("/app/conversations");
  revalidatePath(`/app/conversations/${conversationId}`);
}

/* ─── Taking over ──────────────────────────────────────────────────────── */

/**
 * A person joins a live call.
 *
 * Writes a `system` turn at the join point rather than silently switching who
 * the replies come from, because "when did a human arrive" is the first
 * question anyone asks of a transcript that has both in it. The conversation
 * is marked uncontained at the same moment: a call a person had to join did
 * not contain, whatever happens next.
 */
export async function takeOverCall(conversationId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const conversation = await scoped(conversationId, brand.id);
  if (conversation.status === "resolved" || conversation.status === "abandoned") {
    throw new Error("That conversation has already ended.");
  }
  if (conversation.handledBy) {
    throw new Error(`${conversation.handledBy} is already on this one.`);
  }

  await db.insert(s.turns).values({
    conversationId,
    ordinal: await nextOrdinal(conversationId),
    speaker: "system",
    body: `${session.name} took the line. The AI has stopped replying.`,
    atSeconds: offset(conversation.startedAt),
  });

  await db
    .update(s.conversations)
    .set({ handledBy: session.name, contained: false })
    .where(eq(s.conversations.id, conversationId));

  // If it was queued for a person, this is that person arriving.
  await db
    .update(s.handoffs)
    .set({
      status: "accepted",
      acceptedAt: new Date(),
      acceptedByMembershipId: session.membershipId,
    })
    .where(and(eq(s.handoffs.conversationId, conversationId), eq(s.handoffs.status, "waiting")));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "call.taken_over",
    target: conversationId,
  });

  refreshConversationScreens(conversationId);
}

/**
 * Hand the conversation back to the AI.
 *
 * Deliberately does not mark it contained again — it was not. The flag records
 * what happened, not what the console would prefer to report.
 */
export async function releaseCall(conversationId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const conversation = await scoped(conversationId, brand.id);
  if (!conversation.handledBy) throw new Error("Nobody is holding this one.");

  await db.insert(s.turns).values({
    conversationId,
    ordinal: await nextOrdinal(conversationId),
    speaker: "system",
    body: `${session.name} handed the conversation back to the AI.`,
    atSeconds: offset(conversation.startedAt),
  });

  await db
    .update(s.conversations)
    .set({ handledBy: null, status: "live" })
    .where(eq(s.conversations.id, conversationId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "call.released",
    target: conversationId,
  });

  refreshConversationScreens(conversationId);
}

/** A person types a reply into a call they hold. */
export async function sendHumanReply(conversationId: string, body: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const text = body.trim();
  if (!text) throw new Error("Nothing to send.");
  if (text.length > 4000) throw new Error("That is too long for one turn.");

  const conversation = await scoped(conversationId, brand.id);
  if (conversation.handledBy !== session.name) {
    throw new Error("Take the line before replying — the AI is still holding it.");
  }

  await db.insert(s.turns).values({
    conversationId,
    ordinal: await nextOrdinal(conversationId),
    speaker: "human",
    authorName: session.name,
    body: text,
    atSeconds: offset(conversation.startedAt),
  });

  refreshConversationScreens(conversationId);
}

/**
 * Put a customer message into a live conversation and let the agent answer.
 *
 * This is the console's way of exercising the real pipeline — retrieval,
 * triggers, authority, citations — against a conversation you are watching.
 * It calls the same `respond()` the channels call, so what you see here is
 * what a customer would have got, including the refusals.
 */
export async function simulateCustomerMessage(conversationId: string, body: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const text = body.trim();
  if (!text) throw new Error("Nothing to send.");

  const conversation = await scoped(conversationId, brand.id);
  if (conversation.handledBy) {
    throw new Error(`${conversation.handledBy} is holding this call — the AI will not reply.`);
  }
  if (conversation.status === "resolved" || conversation.status === "abandoned") {
    throw new Error("That conversation has already ended.");
  }

  const reply = await respond({ conversationId, message: text });

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: reply.escalation ? "agent.escalated" : "agent.replied",
    target: conversationId,
    meta: reply.escalation ? { reason: reply.escalation.reason } : {},
  });

  refreshConversationScreens(conversationId);
  return reply;
}

/**
 * Stop the AI mid-conversation and queue a person.
 *
 * The guardrail button on the live console. Distinct from taking over: this
 * says "the AI should not be handling this" without committing the person who
 * pressed it to handling it themselves.
 */
export async function stopAgent(conversationId: string, reason: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const conversation = await scoped(conversationId, brand.id);
  const why = reason.trim() || "Stopped by a person";

  await db.insert(s.turns).values({
    conversationId,
    ordinal: await nextOrdinal(conversationId),
    speaker: "system",
    body: `${session.name} stopped the AI. Reason: ${why}`,
    atSeconds: offset(conversation.startedAt),
  });

  await db
    .update(s.conversations)
    .set({ status: "waiting_human", outcome: "escalated", contained: false })
    .where(eq(s.conversations.id, conversationId));

  const [existing] = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.conversationId, conversationId), eq(s.handoffs.status, "waiting")))
    .limit(1);

  if (!existing) {
    await db.insert(s.handoffs).values({
      conversationId,
      brandId: brand.id,
      reason: why,
      brief: {
        wants: conversation.intent ?? "Not yet classified",
        alreadyDid: [],
        decision: "A person judged the AI should not continue.",
        openingLine: "Thanks for holding — I've picked this up myself.",
        sensitivities: why,
      },
    });
  }

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "agent.stopped",
    target: conversationId,
    meta: { reason: why },
  });

  refreshConversationScreens(conversationId);
}

/* ─── Ending and reviewing ─────────────────────────────────────────────── */

/**
 * How long a person actually spent on this, in seconds.
 *
 * Measured from the turn where someone took the line to the last thing they
 * said, rather than from the call's own duration — a colleague who joins for
 * the last ninety seconds of a twenty-minute call cost ninety seconds, and
 * billing the whole call to them would make every handover look ruinous.
 */
async function humanSecondsOn(conversationId: string): Promise<number> {
  const rows = await db
    .select({ speaker: s.turns.speaker, at: s.turns.createdAt, body: s.turns.body })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  const joined = rows.findIndex(
    (t) => t.speaker === "human" || (t.speaker === "system" && /took the line/i.test(t.body)),
  );
  if (joined === -1) return 0;

  const last = rows[rows.length - 1];
  return Math.max(0, Math.round((last.at.getTime() - rows[joined].at.getTime()) / 1000));
}

export async function resolveConversation(conversationId: string, outcome: "human_resolved" | "ai_resolved") {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const conversation = await scoped(conversationId, brand.id);
  const endedAt = new Date();

  await db
    .update(s.conversations)
    .set({
      status: "resolved",
      outcome,
      endedAt,
      durationSeconds: Math.floor((endedAt.getTime() - conversation.startedAt.getTime()) / 1000),
    })
    .where(eq(s.conversations.id, conversationId));

  await db
    .update(s.handoffs)
    .set({ status: "resolved", resolution: outcome })
    .where(and(eq(s.handoffs.conversationId, conversationId), eq(s.handoffs.status, "accepted")));

  // A person's time is the largest line on any conversation that had one.
  const humanSeconds = await humanSecondsOn(conversationId);
  if (humanSeconds > 0) await billConversation(conversationId, { humanSeconds });

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "conversation.resolved",
    target: conversationId,
    meta: { outcome },
  });

  refreshConversationScreens(conversationId);
}

/**
 * Score a finished conversation.
 *
 * Reviews feed the quality figures on the analytics screen, so this refuses a
 * score outside 1–5 rather than clamping — a clamped 9 would quietly become a
 * 5 and nobody would know the rating was wrong.
 */
export async function reviewConversation(conversationId: string, score: number, note: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("A review score is a whole number from 1 to 5.");
  }
  await scoped(conversationId, brand.id);

  await db
    .update(s.conversations)
    .set({
      reviewScore: score,
      reviewerName: session.name,
      reviewNote: note.trim() || null,
      reviewedAt: new Date(),
    })
    .where(eq(s.conversations.id, conversationId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "conversation.reviewed",
    target: conversationId,
    meta: { score },
  });

  refreshConversationScreens(conversationId);
}

/**
 * Start a conversation from the console.
 *
 * Used to open a new line with a customer — an outbound follow-up, or a way to
 * put the agent in front of a real record without waiting for a call.
 */
export async function startConversation(customerId: string, channel: "phone" | "whatsapp" | "web_chat" | "email" | "sms") {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const [customer] = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.id, customerId), eq(s.customers.brandId, brand.id)))
    .limit(1);
  if (!customer) throw new Error("No such customer in this brand.");

  const [liveVersion] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "live")))
    .limit(1);

  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: brand.id,
      customerId,
      channel,
      status: "live",
      intent: null,
      agentVersionId: liveVersion?.id ?? null,
      startedAt: new Date(),
    })
    .returning();

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "conversation.opened",
    target: conversation.id,
    meta: { channel, customer: customer.name },
  });

  refreshConversationScreens(conversation.id);
  return conversation.id;
}

/** The transcript, for the export capability the role matrix gates. */
export async function exportTranscript(conversationId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "transcripts.export", { brandId: brand.id });

  const conversation = await scoped(conversationId, brand.id);
  const rows = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "transcripts.exported",
    target: conversationId,
    meta: { turns: rows.length },
  });

  const header = [
    `Conversation ${conversation.id}`,
    `Intent: ${conversation.intent ?? "—"}`,
    `Channel: ${conversation.channel}`,
    `Started: ${conversation.startedAt.toISOString()}`,
    "",
  ].join("\n");

  return (
    header +
    rows
      .map((t) => `[${t.ordinal}] ${t.authorName ?? t.speaker}: ${t.body}`)
      .join("\n")
  );
}
