import { generateText, tool } from "ai";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { checkAuthority, describeAuthority, formatPence } from "./authority";
import { loadAgentConfig, type AgentConfig } from "./config";
import {
  checkTriggers,
  countHumanRequests,
  describeNeverRules,
  type ConversationState,
} from "./guardrails";
import { TURN_MODEL, TURN_THINKING } from "./model";
import { grounded, hasGrounding, recordGap, retrieve, type RetrievedChunk } from "./retrieval";
import { writeBrief } from "./brief";

/**
 * One turn of the agent.
 *
 * The order is deliberate and is the product:
 *   1. retrieve, so the reply is grounded or does not happen
 *   2. check triggers, so an escalation pre-empts generation entirely
 *   3. generate, with tools gated by the authority table
 *   4. persist the turn, its citations, and any action taken
 *
 * The same function serves web chat, email and (later) the voice worker, so
 * a customer gets the same answer and the same refusals on every channel.
 */

export type AgentReply = {
  turnId: string;
  text: string;
  citations: { documentTitle: string; anchor: string | null; confidence: number }[];
  /** Set when a guardrail stopped the agent and a human is now needed. */
  escalation: { reason: string; handoffId: string } | null;
  actions: { label: string; allowed: boolean }[];
};

function systemPrompt(config: AgentConfig, context: string, chunks: RetrievedChunk[]): string {
  const sources = grounded(chunks)
    .map(
      (c, i) =>
        `[${i + 1}] ${c.documentTitle}${c.anchor ? ` ${c.anchor}` : ""} (confidence ${(c.confidence * 100).toFixed(0)}%)\n${c.content}`,
    )
    .join("\n\n");

  return `${config.persona}

You are answering for ${config.brandName}.

## What you may do
${describeAuthority(config)}

To take one of these actions, call the \`take_action\` tool. Never claim in
your reply that you have done something unless the tool call succeeded.

## Never
${describeNeverRules(config)}

## What you know about this customer
${context}

## The only sources you may answer from
${sources || "(nothing matched — say you do not know and that you are getting a person)"}

## Rules
- Answer only from the sources above. If they do not cover the question, say
  so plainly and tell the customer you are getting a person. Do not guess, and
  do not soften a refusal into a maybe.
- Cite naturally in your own words; do not print bracket numbers.
- Never state a date, price or fee that is not in the sources or the customer
  context above.
- Be brief. One or two short paragraphs.`;
}

/** Everything the agent is allowed to know about who it is talking to. */
async function customerContext(customerId: string | null): Promise<{ text: string; priority: number | null }> {
  if (!customerId) return { text: "Unidentified caller.", priority: null };

  const [row] = await db
    .select({ customer: s.customers, score: s.customerScores })
    .from(s.customers)
    .leftJoin(s.customerScores, eq(s.customerScores.customerId, s.customers.id))
    .where(eq(s.customers.id, customerId))
    .orderBy(sql`${s.customerScores.computedAt} DESC NULLS LAST`)
    .limit(1);

  if (!row) return { text: "Unidentified caller.", priority: null };

  const c = row.customer;
  const lines = [
    `Name: ${c.name}`,
    c.tier && `Tier: ${c.tier}`,
    c.segment && `Segment: ${c.segment}`,
    `Lifetime value: ${formatPence(c.ltvPence)}`,
    c.location && `Location: ${c.location}`,
    row.score && `Priority: ${Math.round(row.score.blended)} of 100`,
  ].filter(Boolean);

  return { text: lines.join("\n"), priority: row.score ? Math.round(row.score.blended) : null };
}

export async function respond(opts: {
  conversationId: string;
  message: string;
}): Promise<AgentReply> {
  const { conversationId, message } = opts;

  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conversation) throw new Error(`No conversation ${conversationId}`);

  const config = await loadAgentConfig(conversation.brandId, conversation.agentVersionId ?? undefined);
  if (!config) throw new Error(`No live agent version for brand ${conversation.brandId}`);

  const history = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  // 1. Record what the customer said.
  const nextOrdinal = history.length;
  await db
    .insert(s.turns)
    .values({ conversationId, ordinal: nextOrdinal, speaker: "customer", body: message });

  // 2. Retrieve before deciding anything.
  const chunks = await retrieve(conversation.brandId, message);
  const best = chunks[0]?.confidence ?? null;

  const utterances = [
    ...history.filter((t) => t.speaker === "customer").map((t) => t.body),
    message,
  ];
  const { text: context, priority } = await customerContext(conversation.customerId);

  const state: ConversationState = {
    customerUtterances: utterances,
    sentiment: conversation.sentimentEnd ?? null,
    humanRequests: countHumanRequests(utterances),
    priority,
    retrievalConfidence: best,
    authorityExceeded: false,
  };

  // 3. A fired trigger pre-empts generation.
  let fired = checkTriggers(config, state);

  if (!hasGrounding(chunks)) {
    await recordGap(conversation.brandId, conversation.intent ?? message.slice(0, 120));
  }

  const actionsTaken: { label: string; allowed: boolean }[] = [];
  let authorityBlocked: string | null = null;

  if (fired.length === 0) {
    // 4. Generate, with every action gated by the authority table.
    const result = await generateText({
      model: TURN_MODEL,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: TURN_THINKING } } },
      system: systemPrompt(config, context, chunks),
      messages: [
        ...history.map((t) => ({
          role: (t.speaker === "customer" ? "user" : "assistant") as "user" | "assistant",
          content: t.body,
        })),
        { role: "user" as const, content: message },
      ],
      tools: {
        take_action: tool({
          description:
            "Take an action on the customer's account. Returns whether it was permitted. " +
            "If it was refused, tell the customer plainly that it is not your decision.",
          inputSchema: z.object({
            action: z.string().describe("Action key, e.g. goodwill_credit, waive_fee"),
            label: z.string().describe("What to show on the timeline"),
            amountPence: z.number().optional().describe("Amount in pence, when money is involved"),
          }),
          execute: async ({ action, label, amountPence }) => {
            const decision = checkAuthority(config, action, amountPence);
            await db.insert(s.conversationActions).values({
              conversationId,
              action,
              label,
              amountPence: amountPence ?? null,
              allowed: decision.allowed,
            });
            actionsTaken.push({ label, allowed: decision.allowed });

            if (!decision.allowed) {
              authorityBlocked = decision.reason;
              return {
                allowed: false,
                reason: decision.reason,
                escalateTo: decision.escalateTo,
              };
            }
            return { allowed: true };
          },
        }),
      },
      stopWhen: (step) => step.steps.length >= 4,
    });

    // An action refused mid-turn is itself an escalation trigger.
    if (authorityBlocked) {
      fired = checkTriggers(config, { ...state, authorityExceeded: true });
    }

    if (fired.length === 0) {
      const [aiTurn] = await db
        .insert(s.turns)
        .values({
          conversationId,
          ordinal: nextOrdinal + 1,
          speaker: "ai",
          body: result.text,
        })
        .returning();

      const cited = grounded(chunks).slice(0, 2);
      if (cited.length) {
        await db.insert(s.turnCitations).values(
          cited.map((c) => ({
            turnId: aiTurn.id,
            documentId: c.documentId,
            chunkId: c.chunkId,
            confidence: c.confidence,
          })),
        );
        await db
          .update(s.documents)
          .set({ citationCount: sql`${s.documents.citationCount} + 1` })
          .where(eq(s.documents.id, cited[0].documentId));
      } else {
        // A turn with no citation is the failure the quality screens count.
        await db.insert(s.qualityFlags).values({
          orgId: (
            await db
              .select({ orgId: s.brands.orgId })
              .from(s.brands)
              .where(eq(s.brands.id, conversation.brandId))
              .limit(1)
          )[0].orgId,
          turnId: aiTurn.id,
          failureClass: "no_citation",
          rootCause: "retrieval below threshold",
          owner: "tenant",
        });
      }

      return {
        turnId: aiTurn.id,
        text: result.text,
        citations: cited.map((c) => ({
          documentTitle: c.documentTitle,
          anchor: c.anchor,
          confidence: c.confidence,
        })),
        escalation: null,
        actions: actionsTaken,
      };
    }
  }

  // 5. Escalate: hold the customer, write the brief, queue the handoff.
  const reason = fired.map((f) => f.detail).join(" ");
  const holdingLine =
    authorityBlocked
      ? `That's not my decision to make, and I'd rather not guess at it. I'm getting someone now — nothing you've been offered so far changes.`
      : `I want to get this right rather than guess, so I'm bringing in a colleague now. Please stay with me.`;

  const [aiTurn] = await db
    .insert(s.turns)
    .values({ conversationId, ordinal: nextOrdinal + 1, speaker: "ai", body: holdingLine })
    .returning();

  const handoff = await writeBrief({
    conversationId,
    brandId: conversation.brandId,
    config,
    reason,
    customerContext: context,
    transcript: [...history.map((t) => `${t.speaker}: ${t.body}`), `customer: ${message}`],
    blockedAction: authorityBlocked,
  });

  await db
    .update(s.conversations)
    .set({ status: "waiting_human", outcome: "escalated", contained: false })
    .where(eq(s.conversations.id, conversationId));

  return {
    turnId: aiTurn.id,
    text: holdingLine,
    citations: [],
    escalation: { reason, handoffId: handoff.id },
    actions: actionsTaken,
  };
}
