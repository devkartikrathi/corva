import { streamText, tool } from "ai";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { checkAuthority, describeAuthority } from "./authority";
import { formatRupees } from "@/lib/money";
import { loadAgentConfig, type AgentConfig } from "./config";
import {
  checkTriggers,
  countHumanRequests,
  describeNeverRules,
  type ConversationState,
} from "./guardrails";
import { languageModel, thinkingOptions } from "./model";
import { resolveModel } from "./models";
import { recordModelCall } from "./quota";
import { grounded, hasGrounding, recordGap, retrieve, type RetrievedChunk } from "./retrieval";
import { runningSentiment, scoreUtterance } from "@/lib/pipelines/sentiment";
import { addUsage, priceUsage, type Usage } from "@/lib/pricing";
import { writeBrief } from "./brief";
import { updateLiveSummary } from "./summary";
import { crmInstructions, isUnnamed, saveCallerDetails, scheduleFollowUp } from "@/lib/crm/capture";
import { industryFor } from "@/lib/business/industries";

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
  escalation: { reason: string; handoffId: string; routedTo: string | null } | null;
  /**
   * Set when the customer accepted a no and the conversation ended there.
   *
   * Not an escalation and not a failure — but still a decision, so it leaves a
   * row for a person to confirm rather than passing unseen.
   */
  closure: { outcome: string; handoffId: string } | null;
  actions: { label: string; allowed: boolean }[];
};

/** Exported so the tuning screen can preview a draft without persisting it. */
export function systemPrompt(
  config: AgentConfig,
  context: string,
  chunks: RetrievedChunk[],
  isNewCaller = false,
): string {
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

## When you have to say no
Tell them plainly that it is not your decision. Do not offer it another way.
Then give them exactly two options and stop: a colleague who can decide, or
leaving it where it is. Do not choose for them.

If they say they are happy to leave it, thank them, confirm in one sentence
what was and was not done, and call \`close_with_agreement\`. If they want a
person, or they ask again, or they are still unhappy — that is not agreement,
and a colleague is brought in instead.

## Never
${describeNeverRules(config)}

## What you know about this customer
${context}

## The only sources you may answer from
${sources || "(nothing matched — say you do not have that to hand and offer a callback from the team)"}

## ${crmInstructions({ isNewCaller, leadQuestions: industryFor(config.industry).leadQuestions })
    .replace(/^RECORDING WHAT HAPPENS/, "Recording what happens")}

## Rules
- Answer only from the sources above. If they do not cover the question, say
  so plainly and offer a callback (schedule_follow_up). Do not guess, and
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
  // Named after their number means we do not know who they are yet.
  if (isUnnamed(c.name)) {
    return {
      text: `New caller — not in the records yet. Calling from ${c.phone ?? c.name}, so you already have their number; do not ask for it. You do not know their name.`,
      priority: null,
    };
  }
  const lines = [
    `Name: ${c.name}`,
    c.tier && `Tier: ${c.tier}`,
    c.segment && `Segment: ${c.segment}`,
    `Lifetime value: ${formatRupees(c.ltvPaise)}`,
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
  | { type: "escalation"; reason: string; handoffId: string; routedTo: string | null }
  | { type: "closure"; outcome: string; handoffId: string }
  | { type: "done"; reply: AgentReply };

/** Split on sentence ends, keeping the terminator — TTS needs the punctuation. */
function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  // A terminator followed by whitespace. Decimals and "₹50." survive because
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

  // Whatever this brand is on. Resolved once, so the turn, its billing and the
  // row that records which model answered cannot disagree with each other.
  const model = resolveModel(config.modelId);

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
  /**
   * Set when the customer accepted a no.
   *
   * Handled after generation rather than inside the tool, because the closing
   * sentence the model is still writing is part of what a reviewer reads.
   */
  let closedByAgreement: string | null = null;
  let spoken = "";

  if (fired.length === 0) {
    // 4. Generate, with every action gated by the authority table.
    const result = streamText({
      model: languageModel(model.id),
      providerOptions: thinkingOptions(model.thinking.turn),
      system: systemPrompt(config, context, chunks, context.startsWith("New caller")),
      messages: [
        ...history.map((t) => ({
          role: (t.speaker === "customer" ? "user" : "assistant") as "user" | "assistant",
          content: t.body,
        })),
        { role: "user" as const, content: message },
      ],
      tools: {
        close_with_agreement: tool({
          description:
            "End the conversation by agreement. Only after you could not do what they " +
            "asked, told them so, offered them a colleague, and they said they were " +
            "happy to leave it. Never for a customer who is still unhappy or who wants " +
            "a person.",
          inputSchema: z.object({
            outcome: z
              .string()
              .describe("What was asked for and what they accepted instead, in one line"),
          }),
          execute: async ({ outcome }) => {
            closedByAgreement = outcome;
            return { closed: true };
          },
        }),
        save_caller_details: tool({
          description:
            "Record who the customer is and what they want, as a lead for the team. Call it as soon as " +
            "you know their name and what they are after, and again whenever you learn more.",
          inputSchema: z.object({
            name: z.string().optional().describe("Their name, as they gave it"),
            interest: z.string().describe("What they want, in one line, with specifics"),
            email: z.string().optional(),
            notes: z.string().optional().describe("Budget, timing, preferences"),
            valueRupees: z.number().optional().describe("Budget or order value in rupees, if known"),
          }),
          execute: async (input) => {
            const { lead, created, ownerName } = await saveCallerDetails({
              conversationId,
              brandId: conversation.brandId,
              customerId: conversation.customerId,
              ...input,
              source: conversation.channel,
            });
            actionsTaken.push({ label: `${created ? "New lead" : "Lead updated"}: ${lead.name}`, allowed: true });
            return { saved: true, owner: ownerName ?? "the team" };
          },
        }),
        schedule_follow_up: tool({
          description:
            "Create a task for the team whenever you promise a callback, to send something, or to " +
            "check on something. Returns who will do it and when.",
          inputSchema: z.object({
            task: z.string().describe("What was promised"),
            due: z.string().optional().describe("When, as an ISO date-time with +05:30"),
            detail: z.string().optional(),
          }),
          execute: async ({ task, due, detail }) => {
            const [current] = await db
              .select({ customerId: s.conversations.customerId })
              .from(s.conversations)
              .where(eq(s.conversations.id, conversationId))
              .limit(1);
            const { assigneeName, dueAt } = await scheduleFollowUp({
              conversationId,
              brandId: conversation.brandId,
              customerId: current?.customerId ?? conversation.customerId,
              title: task,
              detail,
              due,
              createdByName: config.agentName,
              createdByAi: true,
            });
            actionsTaken.push({ label: `Follow-up: ${task}`, allowed: true });
            return {
              scheduled: true,
              who: assigneeName ?? "someone from the team",
              when: dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", hour: "numeric", minute: "2-digit" }),
            };
          },
        }),
        take_action: tool({
          description:
            "Take an action on the customer's account. Returns whether it was permitted. " +
            "If it was refused, tell the customer plainly that it is not your decision.",
          inputSchema: z.object({
            action: z.string().describe("Action key, e.g. goodwill_credit, waive_fee"),
            label: z.string().describe("What to show on the timeline"),
            amountPaise: z.number().optional().describe("Amount in paise, when money is involved"),
          }),
          execute: async ({ action, label, amountPaise }) => {
            const decision = checkAuthority(config, action, amountPaise);
            await db.insert(s.conversationActions).values({
              conversationId,
              action,
              label,
              amountPaise: amountPaise ?? null,
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
      stopWhen: (step) => step.steps.length >= 5,
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

    /**
     * The request is spent by this point, whichever way the turn goes.
     *
     * Counted here rather than in the branch below, because a turn that
     * generated and was then stopped by a refused action still drew on the
     * day's ration — and the ration is the thing that runs out mid-demo. The
     * token counts come with it when the stream ran to completion; when it was
     * abandoned mid-flight they are not asked for, since awaiting usage on a
     * cancelled stream is a wait with nobody to end it.
     */
    const consumed = authorityBlocked ? undefined : await result.usage;
    await recordModelCall(model.id, consumed ?? undefined);

    // An action refused mid-turn is itself an escalation trigger.
    if (authorityBlocked) {
      fired = checkTriggers(config, { ...state, authorityExceeded: true });
    }

    if (fired.length === 0) {
      const text = spoken.trim() || (await result.text);
      // The model reports what it actually consumed; nothing here is inferred
      // from the length of the reply.
      await billConversation(
        conversationId,
        {
          inputTokens: consumed?.inputTokens ?? undefined,
          outputTokens: consumed?.outputTokens ?? undefined,
          // Retrieval embedded the customer's message before any of this ran.
          embeddingTokens: Math.ceil(message.length / 4),
        },
        model.id,
      );
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

      /**
       * The customer accepted a no.
       *
       * Written into the same queue as an escalation, marked
       * `closure_approval`, because "the AI talked someone out of a refund" is
       * precisely the decision that otherwise never reaches a person: nothing
       * was spent and nobody was queued, so nothing would land anywhere. One
       * row is the difference between a refusal being policy and a refusal
       * being a habit nobody noticed.
       */
      let closure: AgentReply["closure"] = null;
      if (closedByAgreement) {
        const handoff = await writeBrief({
          conversationId,
          brandId: conversation.brandId,
          config,
          reason: closedByAgreement,
          customerContext: context,
          transcript: [
            ...history.map((h) => `${h.speaker}: ${h.body}`),
            `customer: ${message}`,
            `ai: ${text}`,
          ],
          blockedAction: authorityBlocked,
          kind: "closure_approval",
        });

        await db
          .update(s.conversations)
          .set({ status: "resolved", outcome: "ai_resolved", endedAt: new Date() })
          .where(eq(s.conversations.id, conversationId));

        closure = { outcome: closedByAgreement, handoffId: handoff.id };
        yield { type: "closure", outcome: closedByAgreement, handoffId: handoff.id };
      } else {
        // Keep the one-line account current for anyone about to take the line.
        // Rate-limited inside, and skipped entirely once the call has ended.
        await updateLiveSummary(conversationId);
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
          closure,
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

  await billConversation(
    conversationId,
    { embeddingTokens: Math.ceil(message.length / 4) },
    model.id,
  );

  const routedTo = handoff.routedTo?.name ?? null;
  yield { type: "escalation", reason, handoffId: handoff.id, routedTo };
  yield {
    type: "done",
    reply: {
      turnId: aiTurn.id,
      text: body,
      citations: [],
      escalation: { reason, handoffId: handoff.id, routedTo },
      closure: null,
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
export async function billConversation(
  conversationId: string,
  usage: Usage,
  /** The model that did the work, on the first call that knows. */
  modelId?: string,
) {
  const [row] = await db
    .select({ breakdown: s.conversations.costBreakdown, modelId: s.conversations.modelId })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return;

  // Whichever model is already on the row wins: a conversation is priced at
  // the rates of the model that started answering it, even if the brand has
  // been moved since. Only the first caller writes it.
  const model = row.modelId ?? modelId ?? null;

  const previous = ((row.breakdown ?? {}) as { usage?: Usage }).usage ?? {};
  const total = addUsage(previous, usage);
  const cost = priceUsage(total, model);

  await db
    .update(s.conversations)
    .set({
      costPaise: cost.paise,
      costBreakdown: { usage: total, lines: cost.lines },
      ...(row.modelId ? {} : { modelId: model }),
    })
    .where(eq(s.conversations.id, conversationId));
}
