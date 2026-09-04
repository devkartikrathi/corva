import { asc, eq } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { ANALYSIS_MODEL, ANALYSIS_THINKING } from "@/lib/agent/model";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { scoreUtterance } from "./sentiment";

/**
 * What a conversation was about, and how it ended.
 *
 * Both fields are read everywhere — the archive filters on outcome, the
 * knowledge screen counts gaps by intent, analytics prices unfinished intents —
 * and until this module existed both were set once at creation and never
 * revisited. A conversation that opened as "Where is my order?" and became a
 * cancellation kept the wrong label for good.
 *
 * This runs when a conversation closes, off the critical path, so it is allowed
 * to use the analysis model and think properly. Nothing here is on a caller's
 * clock.
 */

const Classification = z.object({
  intent: z
    .string()
    .describe(
      "What the customer actually wanted, as a short noun phrase in the tenant's own " +
        "language. Six words at most. e.g. 'Third delivery reschedule → cancellation threat'",
    ),
  outcome: z
    .enum(["ai_resolved", "human_resolved", "escalated", "no_document", "no_follow_up", "detractor"])
    .describe(
      "ai_resolved: the AI finished it alone. human_resolved: a person finished it. " +
        "escalated: handed over and still open. no_document: the AI had nothing to answer " +
        "from. no_follow_up: nobody came back to them. detractor: they left unhappy.",
    ),
  contained: z
    .boolean()
    .describe("True only if no human said anything and the customer's need was met."),
  summary: z.string().describe("One sentence a colleague could read instead of the transcript."),
});

export type Classification = z.infer<typeof Classification>;

/**
 * Classify one conversation from its transcript.
 *
 * Returns null when there is nothing to classify — a conversation with no
 * customer turn is a dropped call, and labelling it would put a fiction into
 * every count that reads this table.
 */
export async function classifyConversation(conversationId: string): Promise<Classification | null> {
  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conversation) return null;

  const turns = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  if (!turns.some((t) => t.speaker === "customer")) return null;

  const [handoff] = await db
    .select()
    .from(s.handoffs)
    .where(eq(s.handoffs.conversationId, conversationId))
    .limit(1);

  const actions = await db
    .select()
    .from(s.conversationActions)
    .where(eq(s.conversationActions.conversationId, conversationId));

  const { object } = await generateObject({
    model: ANALYSIS_MODEL,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: ANALYSIS_THINKING } } },
    schema: Classification,
    system:
      "You label finished customer-service conversations for a support console. Be literal: " +
      "describe what happened, not what should have happened. The labels drive containment " +
      "figures and cost reporting, so an optimistic reading of a bad call is a reporting error.",
    prompt: [
      `Channel: ${conversation.channel}`,
      handoff ? `A human was queued. Reason: ${handoff.reason}` : "No human was queued.",
      actions.length
        ? `Actions attempted: ${actions.map((a) => `${a.label} (${a.allowed ? "allowed" : "refused"})`).join("; ")}`
        : "No actions were attempted.",
      "",
      "Transcript:",
      ...turns.map((t) => `${t.authorName ?? t.speaker}: ${t.body}`),
    ].join("\n"),
  });

  return object;
}

/**
 * Classify and persist.
 *
 * `contained` is taken from the model's judgement *and* the record: if a human
 * spoke, it was not contained, whatever the transcript reads like. The model is
 * allowed to be generous about outcomes; it is not allowed to be generous about
 * this one, because containment is the number the whole product is sold on.
 */
export async function classifyAndStore(conversationId: string): Promise<Classification | null> {
  const result = await classifyConversation(conversationId);
  if (!result) return null;

  const turns = await db
    .select({ speaker: s.turns.speaker, body: s.turns.body })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  const humanSpoke = turns.some((t) => t.speaker === "human");
  const customerTurns = turns.filter((t) => t.speaker === "customer").map((t) => t.body);

  await db
    .update(s.conversations)
    .set({
      intent: result.intent,
      summary: result.summary,
      outcome: result.outcome,
      contained: result.contained && !humanSpoke,
      sentimentStart: customerTurns[0] !== undefined ? scoreUtterance(customerTurns[0]) : null,
      sentimentEnd: customerTurns.length ? scoreUtterance(customerTurns.at(-1)!) : null,
    })
    .where(eq(s.conversations.id, conversationId));

  return result;
}
