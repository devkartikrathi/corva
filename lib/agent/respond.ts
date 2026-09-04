import { streamText, tool } from "ai";
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
import { TURN_MODEL, TURN_OPTIONS } from "./model";
import { grounded, hasGrounding, recordGap, retrieve, type RetrievedChunk } from "./retrieval";
import { runningSentiment, scoreUtterance } from "@/lib/pipelines/sentiment";
import { addUsage, priceUsage, type Usage } from "@/lib/pricing";
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
 * `respondStream` is the pipeline; `respond` waits for it. The same code
 * serves web chat, email and the voice worker, so a customer gets the same
 * answer and the same refusals on every channel — the only difference is
 * whether the caller hears it a sentence at a time.
 */

export type AgentReply = {
  turnId: string;
  text: string;
  citations: { documentTitle: string; anchor: string | null; confidence: number }[];
  /** Set when a guardrail stopped the agent and a human is now needed. */
  escalation: { reason: string; handoffId: string } | null;
  actions: { label: string; allowed: boolean }[];
};

/** Exported so the tuning screen can preview a draft without persisting it. */
export function systemPrompt(config: AgentConfig, context: string, chunks: RetrievedChunk[]): string {
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
/** Exported so the voice bridge gives its agent the same record the text path has. */
export async function customerContext(customerId: string | null): Promise<{ text: string; priority: number | null }> {
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

/**
 * What a caller hears, as it is produced.
 *
 * `sentence` is the event a voice pipeline waits on: text-to-speech wants a
 * complete clause, not a token, and emitting per token would have TTS
 * re-synthesising the same phrase five times. `delta` is for text surfaces
 * that want the typing effect. Both come off the same generation, so a call
 * and a web chat cannot diverge.
 */
export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "sentence"; text: string }
  | { type: "action"; label: string; allowed: boolean }
  | { type: "escalation"; reason: string; handoffId: string }
  | { type: "done"; reply: AgentReply };

/** Split on sentence ends, keeping the terminator — TTS needs the punctuation. */
function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  // A terminator followed by whitespace. Decimals and "£50." survive because
  // the following character is a digit or end-of-buffer, not a space.
  const boundary = /([.!?])\s+/;
  let match = rest.match(boundary);
  while (match && match.index !== undefined) {
    const end = match.index + match[1].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(end).replace(/^\s+/, "");
    match = rest.match(boundary);
  }
  return { sentences, rest };
}

/**
 * One turn of the agent, streamed.
 *
 * The gates run first and to completion — retrieval, then triggers — because
 * both decide whether the agent speaks at all, and a caller must not hear the
 * first half of an answer the guardrails were about to stop. Only generation
 * streams.
 *
 * The exception worth knowing: an action refused *after* speech has started
 * cannot be unsaid. When that happens the holding line is appended rather than
 * substituted, and the transcript shows both — which is what actually happened
 * on the call.
 */
export async function* respondStream(opts: {
  conversationId: string;
  message: string;
}): AsyncGenerator<AgentEvent, void, undefined> {
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

  // 1. Record what the customer said, with its sentiment.
  //
  // Scored inline with the lexicon rather than the model: this reading is
  // checked by the escalation trigger a few lines below, so it has to exist
  // before generation starts, and a model call there is seconds the caller
  // spends in silence. See lib/pipelines/sentiment.ts.
  const nextOrdinal = history.length;
  const turnSentiment = scoreUtterance(message);
  await db.insert(s.turns).values({
    conversationId,
    ordinal: nextOrdinal,
    speaker: "customer",
    body: message,
    sentiment: turnSentiment,
  });

  // 2. Retrieve before deciding anything.
  const chunks = await retrieve(conversation.brandId, message);
  const best = chunks[0]?.confidence ?? null;

  const utterances = [
    ...history.filter((t) => t.speaker === "customer").map((t) => t.body),
    message,
  ];
  const { text: context, priority } = await customerContext(conversation.customerId);

  // The running figure, weighted towards what was just said — a call that has
  // been recovered should stop escalating, and one that has just turned should
  // escalate now rather than after the average catches up.
  const sentiment = runningSentiment(utterances);

  const state: ConversationState = {
    customerUtterances: utterances,
    sentiment,
    humanRequests: countHumanRequests(utterances),
    priority,
    retrievalConfidence: best,
    authorityExceeded: false,
  };

  // 3. A fired trigger pre-empts generation entirely — nothing is spoken.
  let fired = checkTriggers(config, state);

  await db
    .update(s.conversations)
    .set({
      sentimentEnd: sentiment,
      // The opening reading is whatever the first customer turn scored, and is
      // never overwritten — "it started here and ended there" is the shape the
      // archive prints.
      ...(nextOrdinal === 0 ? { sentimentStart: turnSentiment } : {}),
    })
    .where(eq(s.conversations.id, conversationId));

  // A rehearsal that hits a coverage gap has still found one, but counting it
  // would inflate "asked 14 times" with traffic no customer generated. The
  // tester sees the miss on screen either way.
  if (!hasGrounding(chunks) && !conversation.isTest) {
    await recordGap(conversation.brandId, conversation.intent ?? message.slice(0, 120));
  }

  const actionsTaken: { label: string; allowed: boolean }[] = [];
  let authorityBlocked: string | null = null;
  let spoken = "";

  if (fired.length === 0) {
    // 4. Generate, with every action gated by the authority table.
    const result = streamText({
      model: TURN_MODEL,
      providerOptions: TURN_OPTIONS,
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
              return { allowed: false, reason: decision.reason, escalateTo: decision.escalateTo };
            }
            return { allowed: true };
          },
        }),
      },
      stopWhen: (step) => step.steps.length >= 4,
    });

    let buffer = "";
    for await (const delta of result.textStream) {
      // Nothing is emitted while an action is being refused: the reply that
      // was forming assumed permission it turned out not to have.
      if (authorityBlocked) break;
      buffer += delta;
      spoken += delta;
      yield { type: "delta", text: delta };

      const { sentences, rest } = takeSentences(buffer);
      buffer = rest;
      for (const sentence of sentences) yield { type: "sentence", text: sentence };
    }
    if (!authorityBlocked && buffer.trim()) {
      yield { type: "sentence", text: buffer.trim() };
    }

    for (const action of actionsTaken) {
      yield { type: "action", label: action.label, allowed: action.allowed };
    }

    // An action refused mid-turn is itself an escalation trigger.
    if (authorityBlocked) {
      fired = checkTriggers(config, { ...state, authorityExceeded: true });
    }

    if (fired.length === 0) {
      const text = spoken.trim() || (await result.text);
      // The model reports what it actually consumed; nothing here is inferred
      // from the length of the reply.
      const consumed = await result.usage;
      await billConversation(conversationId, {
        inputTokens: consumed?.inputTokens ?? undefined,
        outputTokens: consumed?.outputTokens ?? undefined,
        // Retrieval embedded the customer's message before any of this ran.
        embeddingTokens: Math.ceil(message.length / 4),
      });
      const [aiTurn] = await db
        .insert(s.turns)
        .values({ conversationId, ordinal: nextOrdinal + 1, speaker: "ai", body: text })
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
      } else if (!conversation.isTest) {
        // A turn with no citation is the failure the quality screens count —
        // and staff should not be triaging a rehearsal.
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

      yield {
        type: "done",
        reply: {
          turnId: aiTurn.id,
          text,
          citations: cited.map((c) => ({
            documentTitle: c.documentTitle,
            anchor: c.anchor,
            confidence: c.confidence,
          })),
          escalation: null,
          actions: actionsTaken,
        },
      };
      return;
    }
  }

  // 5. Escalate: hold the customer, write the brief, queue the handoff.
  const reason = fired.map((f) => f.detail).join(" ");
  const holdingLine = authorityBlocked
    ? `That's not my decision to make, and I'd rather not guess at it. I'm getting someone now — nothing you've been offered so far changes.`
    : `I want to get this right rather than guess, so I'm bringing in a colleague now. Please stay with me.`;

  yield { type: "sentence", text: holdingLine };

  // If speech had already started, both halves are kept: the caller heard the
  // first part, and a transcript that hid it would not match the recording.
  const body = spoken.trim() ? `${spoken.trim()} ${holdingLine}` : holdingLine;

  const [aiTurn] = await db
    .insert(s.turns)
    .values({ conversationId, ordinal: nextOrdinal + 1, speaker: "ai", body })
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

  await billConversation(conversationId, { embeddingTokens: Math.ceil(message.length / 4) });

  yield { type: "escalation", reason, handoffId: handoff.id };
  yield {
    type: "done",
    reply: {
      turnId: aiTurn.id,
      text: body,
      citations: [],
      escalation: { reason, handoffId: handoff.id },
      actions: actionsTaken,
    },
  };
}

/**
 * One turn, waited for.
 *
 * A thin consumer of `respondStream`, so the console and the voice worker run
 * exactly the same pipeline rather than two that drift apart.
 */
export async function respond(opts: {
  conversationId: string;
  message: string;
}): Promise<AgentReply> {
  let reply: AgentReply | null = null;
  for await (const event of respondStream(opts)) {
    if (event.type === "done") reply = event.reply;
  }
  if (!reply) throw new Error("The agent produced no reply.");
  return reply;
}


/**
 * Add what a turn consumed to the conversation's running cost.
 *
 * Read-modify-write rather than an atomic increment because the breakdown is a
 * document, not a counter — and a conversation is a serial thing, one turn at
 * a time, so there is no second writer to race.
 */
export async function billConversation(conversationId: string, usage: Usage) {
  const [row] = await db
    .select({ breakdown: s.conversations.costBreakdown })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return;

  const previous = ((row.breakdown ?? {}) as { usage?: Usage }).usage ?? {};
  const total = addUsage(previous, usage);
  const cost = priceUsage(total);

  await db
    .update(s.conversations)
    .set({
      costPence: cost.pence,
      costBreakdown: { usage: total, lines: cost.lines },
    })
    .where(eq(s.conversations.id, conversationId));
}
