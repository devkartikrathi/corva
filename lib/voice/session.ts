import { and, asc, eq, sql } from "drizzle-orm";
import { checkAuthority } from "@/lib/agent/authority";
import { loadAgentConfig, type AgentConfig } from "@/lib/agent/config";
import { describeNeverRules } from "@/lib/agent/guardrails";
import { grounded, retrieve, recordGap } from "@/lib/agent/retrieval";
import { writeBrief } from "@/lib/agent/brief";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { runningSentiment, scoreUtterance } from "@/lib/pipelines/sentiment";

/**
 * A Corva agent, expressed as a Gemini Live session.
 *
 * The console's `respondStream` runs its gates in a fixed order — retrieve,
 * check triggers, then speak — because it controls when generation starts. A
 * Live session inverts that: the model is already talking, and the only way to
 * gate it is to make every consequential act a tool call the bridge answers.
 *
 * So the three things the product actually promises become three tools:
 *
 *   search_knowledge  the agent may only assert what a document says
 *   take_action       nothing happens above an authority ceiling
 *   escalate          a limit reached writes a brief and queues a human
 *
 * That is the same contract as the text path, enforced at a different seam.
 *
 * One difference from the text path is deliberate: the ceilings are *not*
 * described in the system instruction. The console's prompt lists them, which
 * is fine when a person reads the output — but on a call the model would
 * cheerfully refuse from memory without calling `take_action`, and a refusal
 * that leaves no row behind is invisible to the Handoffs and Live screens.
 * Withholding the table forces the call, which makes the code the enforcement
 * rather than the prompt. Measured: with the table in the prompt, zero actions
 * were recorded across two runs.
 */

export type ToolOutcome = {
  name: string;
  summary: string;
  allowed: boolean;
  detail?: string;
};

/**
 * Tool declarations, in Gemini's schema dialect.
 *
 * Note the uppercase types — the Live API wants OpenAPI-style `STRING`, not the
 * JSON-Schema `string` the REST models accept.
 */
export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "search_knowledge",
        description:
          "Look up this brand's documents. You may only state facts that come back from " +
          "this tool. Call it before answering any question about policy, price, warranty, " +
          "delivery or entitlement.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "What to look up, in the caller's words" },
          },
          required: ["query"],
        },
      },
      {
        name: "take_action",
        description:
          "Do something to the customer's account. Returns whether it was permitted. " +
          "If it was refused, say so plainly and do not offer it another way.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", description: "Key, e.g. goodwill_credit, waive_fee" },
            label: { type: "STRING", description: "What to show on the timeline" },
            amountPence: { type: "NUMBER", description: "Amount in pence, when money is involved" },
          },
          required: ["action", "label"],
        },
      },
      {
        name: "escalate_to_human",
        description:
          "Hand the call to a person. Use when you have reached a limit, the caller asks " +
          "twice, or they mention cancelling, a complaint, a solicitor or an ombudsman.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING", description: "Why a person is needed" },
          },
          required: ["reason"],
        },
      },
    ],
  },
];

/**
 * The system instruction.
 *
 * Built from the same `AgentConfig` the text path uses, so the persona, the
 * ceilings and the never-rules on the Tuning screen are what the caller hears.
 * The one addition is conversational: a caller cannot see a spinner, so silence
 * while a tool runs reads as a dropped line.
 */
export function liveInstruction(config: AgentConfig, brandName: string, caller: string): string {
  return [
    config.persona,
    "",
    `You are on a live phone call for ${brandName}. You are speaking out loud, not writing.`,
    "",
    "WHO YOU ARE TALKING TO",
    caller,
    "Use their name once, at the start. Never invent a name, a date, or a detail that is not",
    "written above — if the caller is not recognised, ask rather than guess.",
    "",
    "HOW TO TALK",
    "- One or two sentences at a time. Never deliver a paragraph.",
    "- Contractions, plain words, no bullet points, no markdown, no emoji.",
    "- Say numbers the way a person says them: 'fifty pounds', 'the fifth of March'.",
    "- Let them interrupt you. If they start talking, stop.",
    "",
    "WHILE YOU ARE LOOKING SOMETHING UP",
    "- The caller cannot see you working, and silence sounds like a dropped call.",
    "- Say something first, out loud, then call the tool. For example:",
    "    'Let me pull that up for you, one moment.'",
    "    'Bear with me while I check your record.'",
    "    'Good question — give me a second to look at the policy on that.'",
    "- Vary it. Never use the same holding phrase twice in one call.",
    "- If a lookup is taking a while, say so again rather than going quiet.",
    "",
    "WHAT YOU MAY SAY",
    "- Only what search_knowledge returned. If it returns nothing useful, say you",
    "  do not have it in front of you and offer to get someone who does.",
    "- Never invent a date, a price, or a policy. Never guess at one.",
    "",
    describeNeverRules(config),
    "",
    "WHAT YOU ARE ALLOWED TO DO",
    "You have limited authority on this account, and you do not know what the limits",
    "are. The only way to find out is to call take_action and read the answer.",
    "",
    "So: whenever the caller asks for anything done to their account — a credit, a",
    "refund, a waiver, a reschedule, a change of contract — call take_action first.",
    "Never assume you can. Never assume you cannot. Say a holding phrase, call it, and",
    "then tell them what came back.",
    "",
    "If it comes back refused, tell the caller plainly that it is not your decision,",
    "and offer to bring in a colleague. Do not offer it another way, and do not",
    "apologise more than once for the same thing — fix it instead.",
  ].join("\n");
}

/** The setup frame that opens a Live session. */
export function setupMessage(
  config: AgentConfig,
  brandName: string,
  model: string,
  caller: string,
) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        // Voice replies are short by construction; this is the backstop for
        // when the model forgets, and it caps the cost of a runaway turn.
        maxOutputTokens: 400,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
      systemInstruction: { parts: [{ text: liveInstruction(config, brandName, caller) }] },
      tools: TOOLS,
      // Both sides as text, so turns persist without a second STT pass.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/* ─── Tool handling ────────────────────────────────────────────────────── */

/**
 * Answer a tool call the way the console would.
 *
 * Every branch writes the same rows the text path writes, so a call made in the
 * playground shows up on the Conversations screen looking like any other.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: { conversationId: string; brandId: string; config: AgentConfig },
): Promise<{ response: Record<string, unknown>; outcome: ToolOutcome }> {
  if (name === "search_knowledge") {
    const query = String(args.query ?? "");
    const chunks = await retrieve(ctx.brandId, query);
    const useful = grounded(chunks);

    if (useful.length === 0) {
      // A question with nothing behind it is the gap the Knowledge screen counts.
      await recordGap(ctx.brandId, query.slice(0, 120));
      return {
        response: {
          found: false,
          instruction:
            "Nothing in the knowledge base covers this. Tell the caller you do not have it " +
            "in front of you, and offer to get a colleague. Do not guess.",
        },
        outcome: { name, summary: `no document for "${query}"`, allowed: false },
      };
    }

    return {
      response: {
        found: true,
        sources: useful.slice(0, 3).map((c) => ({
          document: c.documentTitle,
          anchor: c.anchor,
          confidence: Number(c.confidence.toFixed(2)),
          text: c.content,
        })),
      },
      outcome: {
        name,
        summary: `${useful.length} source${useful.length === 1 ? "" : "s"} for "${query}"`,
        allowed: true,
        detail: useful.slice(0, 2).map((c) => c.documentTitle).join(", "),
      },
    };
  }

  if (name === "take_action") {
    const action = String(args.action ?? "");
    const label = String(args.label ?? action);
    const amountPence =
      typeof args.amountPence === "number" ? Math.round(args.amountPence) : undefined;

    const decision = checkAuthority(ctx.config, action, amountPence);
    await db.insert(s.conversationActions).values({
      conversationId: ctx.conversationId,
      action,
      label,
      amountPence: amountPence ?? null,
      allowed: decision.allowed,
    });

    return {
      response: decision.allowed
        ? { allowed: true }
        : { allowed: false, reason: decision.reason, escalateTo: decision.escalateTo },
      outcome: {
        name,
        summary: label,
        allowed: decision.allowed,
        detail: decision.allowed ? undefined : decision.reason,
      },
    };
  }

  if (name === "escalate_to_human") {
    const reason = String(args.reason ?? "The agent reached a limit.");
    const turns = await db
      .select()
      .from(s.turns)
      .where(eq(s.turns.conversationId, ctx.conversationId))
      .orderBy(asc(s.turns.ordinal));

    const handoff = await writeBrief({
      conversationId: ctx.conversationId,
      brandId: ctx.brandId,
      config: ctx.config,
      reason,
      customerContext: "Voice playground session.",
      transcript: turns.map((t) => `${t.speaker}: ${t.body}`),
      blockedAction: null,
    });

    await db
      .update(s.conversations)
      .set({ status: "waiting_human", outcome: "escalated", contained: false })
      .where(eq(s.conversations.id, ctx.conversationId));

    return {
      response: {
        queued: true,
        instruction:
          "A colleague is now queued. Tell the caller you are bringing someone in, that " +
          "they will not have to repeat themselves, and hold the line warmly.",
      },
      outcome: { name, summary: reason, allowed: true, detail: `handoff ${handoff.id.slice(0, 8)}` },
    };
  }

  return {
    response: { error: `Unknown tool ${name}` },
    outcome: { name, summary: "unknown tool", allowed: false },
  };
}

/* ─── Persistence ──────────────────────────────────────────────────────── */

/**
 * Append a turn, so a call reads like any other conversation.
 *
 * Customer turns are scored on the way in. The text path does this inside
 * `respondStream`, and without it here a voice call would carry no sentiment
 * at all — which would leave the "sentiment below −0.40" guardrail blind on
 * precisely the channel where a caller's tone is most of the signal.
 */
export async function persistTurn(
  conversationId: string,
  speaker: "customer" | "ai" | "system",
  body: string,
  startedAt: Date,
) {
  // Live sends transcription in fragments that do not always carry their own
  // spacing, so a naive concatenation gives "One moment.The frame has…".
  const text = body
    .replace(/\s+/g, " ")
    .replace(/([.!?,])(?=[A-Za-z£$])/g, "$1 ")
    .trim();
  if (!text) return;

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${s.turns.ordinal}), -1) + 1` })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId));

  const sentiment = speaker === "customer" ? scoreUtterance(text) : null;

  await db.insert(s.turns).values({
    conversationId,
    ordinal: Number(next),
    speaker,
    body: text,
    sentiment,
    atSeconds: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)),
  });

  if (speaker !== "customer") return;

  // Keep the conversation's running figure current, so the live console and
  // the archive read the same number the guardrail is checking.
  const said = await db
    .select({ body: s.turns.body })
    .from(s.turns)
    .where(and(eq(s.turns.conversationId, conversationId), eq(s.turns.speaker, "customer")))
    .orderBy(asc(s.turns.ordinal));

  await db
    .update(s.conversations)
    .set({
      sentimentEnd: runningSentiment(said.map((t) => t.body)),
      ...(said.length === 1 ? { sentimentStart: sentiment } : {}),
    })
    .where(eq(s.conversations.id, conversationId));
}

/** Who could be on the other end, for the caller picker. */
export async function callersFor(brandSlug: string) {
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, brandSlug)).limit(1);
  if (!brand) return [];
  const rows = await db
    .select()
    .from(s.customers)
    .where(eq(s.customers.brandId, brand.id))
    .orderBy(s.customers.name);
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    detail: [c.tier, c.phone].filter(Boolean).join(" · "),
  }));
}

/**
 * Open a conversation for a call.
 *
 * Nothing here marks it as a test. It is a real row on a real brand, and it
 * appears on the live console, the handoff queue and the archive exactly as an
 * inbound call would — which is the point: a rehearsal that writes to a
 * different table rehearses nothing.
 *
 * The caller is chosen rather than assumed. Ringing in as Marguerite Okonkwo,
 * whose record shows three reschedules and a priority of 99, is a different
 * call from ringing in as a number nobody recognises, and the difference is
 * most of what the agent is reasoning about.
 */
export async function openVoiceConversation(brandSlug: string, customerId?: string | null) {
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, brandSlug)).limit(1);
  if (!brand) throw new Error(`No brand ${brandSlug}`);

  const config = await loadAgentConfig(brand.id);
  if (!config) throw new Error(`${brand.name} has no live agent version.`);

  // An explicit caller, or none — an unrecognised number is a real case, and
  // the agent should be exercised against it too.
  const [customer] = customerId
    ? await db
        .select()
        .from(s.customers)
        .where(and(eq(s.customers.id, customerId), eq(s.customers.brandId, brand.id)))
        .limit(1)
    : [null];

  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: brand.id,
      customerId: customer?.id ?? null,
      channel: "phone",
      status: "live",
      // Left unset: the classifier names it from the transcript when the call
      // ends, the same way it does for every other conversation. A hardcoded
      // label here would be the one thing marking this as not a real call.
      intent: null,
      agentVersionId: config.versionId,
      startedAt: new Date(),
    })
    .returning();

  return { brand, config, customer: customer ?? null, conversation };
}

/**
 * Close the call.
 *
 * Containment is read off the transcript rather than assumed: if no human
 * spoke and the agent never escalated, the AI did in fact handle it, and
 * recording otherwise would understate the only number the product is sold on.
 * Intent and outcome are left for the classifier.
 */
export async function closeVoiceConversation(conversationId: string, seconds: number) {
  const turns = await db
    .select({ speaker: s.turns.speaker })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId));


  const [current] = await db
    .select({ status: s.conversations.status })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);

  // A call already queued for a person stays that way — hanging up does not
  // resolve the thing that needed someone.
  if (current?.status === "waiting_human") {
    await db
      .update(s.conversations)
      .set({ endedAt: new Date(), durationSeconds: seconds })
      .where(eq(s.conversations.id, conversationId));
    return;
  }

  const humanSpoke = turns.some((t) => t.speaker === "human");
  const exchanged = turns.some((t) => t.speaker === "customer");

  // A refused action or a queued handoff means the agent hit a limit, whatever
  // the transcript sounds like.
  const [refused] = await db
    .select({ id: s.conversationActions.id })
    .from(s.conversationActions)
    .where(
      and(
        eq(s.conversationActions.conversationId, conversationId),
        eq(s.conversationActions.allowed, false),
      ),
    )
    .limit(1);

  // Nobody spoke: that is what `abandoned` is for, and the outcome stays null
  // because there genuinely was not one.
  await db
    .update(s.conversations)
    .set({
      status: exchanged ? "resolved" : "abandoned",
      endedAt: new Date(),
      durationSeconds: seconds,
      /**
       * Never claimed, only denied.
       *
       * "No human spoke" is not evidence the customer was helped — an agent
       * that refused everything and was hung up on scores the same. Anything
       * that went visibly wrong is recorded as uncontained now; everything
       * else waits for the classifier, which reads the transcript. Guessing
       * generously here would inflate the one number the product is sold on.
       */
      contained: humanSpoke || refused ? false : null,
      outcome: humanSpoke ? "human_resolved" : null,
    })
    .where(eq(s.conversations.id, conversationId));
}
