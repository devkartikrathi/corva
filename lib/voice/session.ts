import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { checkAuthority } from "@/lib/agent/authority";
import { loadAgentConfig, type AgentConfig } from "@/lib/agent/config";
import { describeNeverRules } from "@/lib/agent/guardrails";
import { grounded, retrieve, recordGap } from "@/lib/agent/retrieval";
import { writeBrief } from "@/lib/agent/brief";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { runningSentiment, scoreUtterance } from "@/lib/pipelines/sentiment";
import { brandForNumber, formatPhone } from "@/lib/business/phone";
import { industryFor } from "@/lib/business/industries";
import {
  crmInstructions,
  customerForCaller,
  isUnnamed,
  saveCallerDetails,
  scheduleFollowUp,
} from "@/lib/crm/capture";

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
            amountPaise: { type: "NUMBER", description: "Amount in paise, when money is involved" },
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
      {
        name: "save_caller_details",
        description:
          "Record who the caller is and what they want, as a lead for the team. Call it as soon as " +
          "you know their name and what they are after, and again whenever you learn more.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "The caller's name, as they said it" },
            phone: { type: "STRING", description: "A phone number they gave, if different from the one they are calling from" },
            interest: { type: "STRING", description: "What they want, in one line, with specifics" },
            email: { type: "STRING", description: "Email, if they gave one" },
            notes: { type: "STRING", description: "Anything else useful: budget, timing, preferences" },
            valueRupees: { type: "NUMBER", description: "Budget or order value in rupees, if known" },
          },
          required: ["interest"],
        },
      },
      {
        name: "schedule_follow_up",
        description:
          "Create a task for the team whenever you promise a callback, to send something, or to check " +
          "on something. Returns who will do it and when.",
        parameters: {
          type: "OBJECT",
          properties: {
            task: { type: "STRING", description: "What was promised, e.g. 'Call back with price for 2BHK in Tower B'" },
            due: { type: "STRING", description: "When, as an ISO date-time with +05:30" },
            detail: { type: "STRING", description: "Context the person will need" },
          },
          required: ["task"],
        },
      },
      {
        name: "close_with_agreement",
        description:
          "End the call by agreement. Use ONLY when you could not do what the caller " +
          "asked, you told them so, you offered them a colleague, and they said they " +
          "were happy to leave it. Never use it to end a call the caller is still " +
          "unhappy about, and never instead of escalate_to_human when they want a person.",
        parameters: {
          type: "OBJECT",
          properties: {
            outcome: {
              type: "STRING",
              description: "What was asked for and what they accepted instead, in one line",
            },
          },
          required: ["outcome"],
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
export function liveInstruction(
  config: AgentConfig,
  brandName: string,
  caller: string,
  isNewCaller = false,
): string {
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
    "- Say numbers the way a person says them: 'five thousand rupees', 'the fifth of March'.",
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
    "WHEN SOMETHING COMES BACK REFUSED",
    "Tell the caller plainly that it is not your decision. Do not offer it another",
    "way, and do not apologise more than once for the same thing.",
    "",
    "Then give them exactly two options, out loud, and stop talking:",
    "  1. you bring in a colleague who can make that decision, or",
    "  2. they are happy to leave it where it is.",
    "",
    "Wait for their answer. Do not choose for them, and do not assume the first.",
    "",
    "If they want a colleague, call escalate_to_human.",
    "If they say they are happy to leave it, thank them properly — they have just",
    "taken a no well — confirm in one sentence what was and was not done, and call",
    "close_with_agreement. A colleague still reviews it afterwards; you do not need",
    "to tell the caller that.",
    "",
    "If they are still unhappy, or they ask again, that is not agreement. Escalate.",
    "",
    crmInstructions({ isNewCaller, leadQuestions: industryFor(config.industry).leadQuestions }),
    "",
    "NEVER SAY A TOOL'S NAME OUT LOUD",
    "The caller is on a phone. They cannot see tools and must never hear one named.",
    "Do not say 'search_knowledge', 'take_action', 'calls take_action', or narrate",
    "that you are calling anything. Invoke it silently and speak only the result.",
    "",
    "And never tell the caller you have done something you have not. Saying you have",
    "'requested' or 'applied' something without take_action returning allowed is the",
    "worst thing you can do on this call — it is a promise the company then has to",
    "break. If you did not call the tool, you did not do the thing.",
  ].join("\n");
}

/** The setup frame that opens a Live session. */
export function setupMessage(
  config: AgentConfig,
  brandName: string,
  model: string,
  caller: string,
  isNewCaller = false,
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
      systemInstruction: { parts: [{ text: liveInstruction(config, brandName, caller, isNewCaller) }] },
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
  ctx: {
    conversationId: string;
    brandId: string;
    config: AgentConfig;
    isTest: boolean;
    customerId: string | null;
  },
): Promise<{ response: Record<string, unknown>; outcome: ToolOutcome }> {
  if (name === "save_caller_details") {
    const { lead, created, ownerName } = await saveCallerDetails({
      conversationId: ctx.conversationId,
      brandId: ctx.brandId,
      customerId: ctx.customerId,
      name: typeof args.name === "string" ? args.name : undefined,
      phone: typeof args.phone === "string" ? args.phone : undefined,
      email: typeof args.email === "string" ? args.email : undefined,
      interest: typeof args.interest === "string" ? args.interest : undefined,
      notes: typeof args.notes === "string" ? args.notes : undefined,
      valueRupees: typeof args.valueRupees === "number" ? args.valueRupees : undefined,
      source: "phone",
    });
    return {
      response: { saved: true, owner: ownerName ?? "the team" },
      outcome: {
        name,
        summary: `${created ? "New lead" : "Lead updated"}: ${lead.name}${lead.interest ? ` — ${lead.interest}` : ""}`,
        allowed: true,
        detail: ownerName ? `owner ${ownerName}` : "no owner yet",
      },
    };
  }

  if (name === "schedule_follow_up") {
    // The conversation may have been re-pointed at a customer mid-call by
    // save_caller_details, so read it rather than trust the opening value.
    const [conv] = await db
      .select({ customerId: s.conversations.customerId })
      .from(s.conversations)
      .where(eq(s.conversations.id, ctx.conversationId))
      .limit(1);
    const { assigneeName, dueAt } = await scheduleFollowUp({
      conversationId: ctx.conversationId,
      brandId: ctx.brandId,
      customerId: conv?.customerId ?? ctx.customerId,
      title: String(args.task ?? "Call the customer back"),
      detail: typeof args.detail === "string" ? args.detail : undefined,
      due: typeof args.due === "string" ? args.due : undefined,
      createdByName: ctx.config.agentName,
      createdByAi: true,
    });
    const when = dueAt.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      response: { scheduled: true, who: assigneeName ?? "someone from the team", when },
      outcome: {
        name,
        summary: String(args.task ?? "Follow-up"),
        allowed: true,
        detail: `${assigneeName ?? "unassigned"} · ${when}`,
      },
    };
  }

  if (name === "search_knowledge") {
    const query = String(args.query ?? "");
    const chunks = await retrieve(ctx.brandId, query);
    const useful = grounded(chunks);

    if (useful.length === 0) {
      // The gap the Knowledge screen counts — but not for a rehearsal, which
      // would inflate the hit count with traffic no customer generated.
      if (!ctx.isTest) await recordGap(ctx.brandId, query.slice(0, 120));
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
    const amountPaise =
      typeof args.amountPaise === "number" ? Math.round(args.amountPaise) : undefined;

    const decision = checkAuthority(ctx.config, action, amountPaise);
    await db.insert(s.conversationActions).values({
      conversationId: ctx.conversationId,
      action,
      label,
      amountPaise: amountPaise ?? null,
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
      outcome: {
        name,
        summary: reason,
        allowed: true,
        // Who it actually rang at, not just that a queue exists — the tester
        // needs to be able to check that the alert went to the right person.
        detail: handoff.routedTo ? `ringing ${handoff.routedTo.name}` : "queued · nobody free",
      },
    };
  }

  if (name === "close_with_agreement") {
    const outcome = String(args.outcome ?? "The customer accepted the outcome.");
    const turns = await db
      .select()
      .from(s.turns)
      .where(eq(s.turns.conversationId, ctx.conversationId))
      .orderBy(asc(s.turns.ordinal));

    /**
     * A closure is written as a handoff too, and that is the point.
     *
     * The AI talking a customer out of something is exactly the decision that
     * would otherwise never be reviewed — nothing was spent, nobody was
     * queued, so nothing lands in front of a person. Writing it into the same
     * queue as an escalation, marked `closure_approval`, means someone sees it
     * and can reopen it. It costs one row and it is the difference between a
     * refusal being a policy and a refusal being a habit.
     */
    const handoff = await writeBrief({
      conversationId: ctx.conversationId,
      brandId: ctx.brandId,
      config: ctx.config,
      reason: outcome,
      customerContext: "Voice playground session.",
      transcript: turns.map((t) => `${t.speaker}: ${t.body}`),
      blockedAction: null,
      kind: "closure_approval",
    });

    await db
      .update(s.conversations)
      .set({ status: "resolved", outcome: "ai_resolved", endedAt: new Date() })
      .where(eq(s.conversations.id, ctx.conversationId));

    return {
      response: {
        closed: true,
        instruction:
          "Thank them once, warmly and briefly, say goodbye, and stop. Do not re-open " +
          "what you have just closed and do not offer anything further.",
      },
      outcome: {
        name,
        summary: outcome,
        allowed: true,
        detail: `closed by agreement · ${handoff.id.slice(0, 8)}`,
      },
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
    .replace(/([.!?,])(?=[A-Za-z₹$])/g, "$1 ")
    .trim();
  if (!text) return;

  const sentiment = speaker === "customer" ? scoreUtterance(text) : null;
  const atSeconds = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));

  /**
   * The ordinal is chosen inside the insert, not before it.
   *
   * Reading `max(ordinal) + 1` and then inserting is two statements with a gap
   * in the middle, and `(conversation_id, ordinal)` is unique — so two turns
   * persisted close together both read the same maximum and the second one
   * dies on the constraint. That is not hypothetical: it took the bridge down
   * mid-call, on the very first turn of a conversation.
   *
   * As a single statement the subquery and the insert see the same snapshot,
   * so concurrent callers get consecutive ordinals instead of a collision.
   */
  await db.execute(sql`
    INSERT INTO ${s.turns} (conversation_id, ordinal, speaker, body, sentiment, at_seconds)
    SELECT ${conversationId}::uuid,
           coalesce(max(t.ordinal), -1) + 1,
           ${speaker}::speaker,
           ${text},
           ${sentiment}::real,
           ${atSeconds}::int
    FROM ${s.turns} t
    WHERE t.conversation_id = ${conversationId}::uuid
  `);

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

/**
 * Who has the line, and what they have typed since `afterOrdinal`.
 *
 * Taking the line happens in the console, which is a different process, so the
 * bridge reads it back rather than being told. The same read picks up the
 * person's replies, because on a playground call the only way the caller finds
 * out what they said is the bridge relaying it.
 */
export async function lineState(conversationId: string, afterOrdinal: number) {
  const [row] = await db
    .select({ handledBy: s.conversations.handledBy })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);

  const replies = await db
    .select({ ordinal: s.turns.ordinal, author: s.turns.authorName, body: s.turns.body })
    .from(s.turns)
    .where(
      and(
        eq(s.turns.conversationId, conversationId),
        eq(s.turns.speaker, "human"),
        gt(s.turns.ordinal, afterOrdinal),
      ),
    )
    .orderBy(asc(s.turns.ordinal));

  return { heldBy: row?.handledBy ?? null, replies };
}

/**
 * What the model is told when the line comes back to it.
 *
 * While a person held the call the model kept hearing the caller and kept
 * composing answers — the bridge dropped them — so its idea of the
 * conversation is wrong in both directions. This puts it right before it
 * speaks again, rather than letting it pick up from a reply nobody heard.
 */
export function handBackNote(heldBy: string, replies: { body: string }[]) {
  return [
    `You were off the line. ${heldBy}, a colleague, spoke to the caller directly.`,
    "Nothing you said in that time reached the caller.",
    replies.length
      ? `What ${heldBy} told them:\n${replies.map((r) => `- ${r.body}`).join("\n")}`
      : `${heldBy} did not say anything you can see.`,
    "You are back on the call now. Do not repeat what was already covered.",
  ].join("\n");
}

/**
 * Every number a test call can reach, with who answers it.
 *
 * Only businesses with a live agent are listed: a number with nobody behind it
 * is a dead line, and the dialer would only be offering a failure.
 */
export async function dialableNumbers() {
  const rows = await db
    .select({ brand: s.brands, address: s.channels.address, org: s.organizations.name })
    .from(s.channels)
    .innerJoin(s.brands, eq(s.brands.id, s.channels.brandId))
    .innerJoin(s.organizations, eq(s.organizations.id, s.brands.orgId))
    .innerJoin(
      s.agentVersions,
      and(eq(s.agentVersions.brandId, s.brands.id), eq(s.agentVersions.status, "live")),
    )
    .where(and(eq(s.channels.kind, "phone"), sql`${s.channels.address} is not null`))
    .orderBy(desc(s.brands.createdAt));
  return rows.map((r) => ({
    number: formatPhone(r.address!),
    brandSlug: r.brand.slug,
    brandId: r.brand.id,
    business: r.brand.name,
    org: r.org,
    agentName: r.brand.agentName,
    industry: industryFor(r.brand.industry).label,
  }));
}

/** Known customers of a business who have a phone number, for "call as". */
export async function callersFor(brandId: string) {
  const rows = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.brandId, brandId), sql`${s.customers.phone} is not null`))
    .orderBy(s.customers.name)
    .limit(200);
  return rows
    .filter((c) => !isUnnamed(c.name))
    .map((c) => ({ name: c.name, phone: formatPhone(c.phone!), detail: [c.tier, c.segment].filter(Boolean).join(" · ") }));
}

/**
 * Open a conversation for a call to a number.
 *
 * The number decides the business, the way a real line does. The caller's own
 * number decides who they are: a known customer is recognised, anyone else is
 * created as a new contact named after their number, so even a caller who
 * hangs up after one sentence leaves a record the team can call back.
 *
 * Nothing here marks the call as fake. It is a real row on a real business,
 * and it appears on the live console, the handoff queue and the archive
 * exactly as an inbound call would — a rehearsal that writes to a different
 * table rehearses nothing. It is only kept out of the numbers (`isTest`).
 */
export async function openVoiceConversation(opts: {
  /** Straight to a business — a website's "talk to us", which has no number to dial. */
  brandId?: string | null;
  /** How the caller introduced themselves, if the site already knows. */
  callerName?: string | null;
  dialed?: string | null;
  /** Fallback when no number is given — older clients pick a brand directly. */
  brandSlug?: string | null;
  callerPhone?: string | null;
  isTest?: boolean;
}) {
  let brand: typeof s.brands.$inferSelect | undefined;
  if (opts.brandId) {
    [brand] = await db.select().from(s.brands).where(eq(s.brands.id, opts.brandId)).limit(1);
  } else if (opts.dialed?.trim()) {
    const found = await brandForNumber(opts.dialed);
    if (!found) throw new Error(`The number ${formatPhone(opts.dialed)} is not in service.`);
    brand = found.brand;
  } else if (opts.brandSlug) {
    [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, opts.brandSlug)).limit(1);
  }
  if (!brand) throw new Error("Dial a business's number to place a call.");

  const config = await loadAgentConfig(brand.id);
  if (!config) throw new Error(`${brand.name} has no AI assistant set up, so nobody answers.`);

  let customer = await customerForCaller(brand.id, opts.callerPhone);
  const callerName = opts.callerName?.trim();
  if (customer && callerName && callerName.length > 1 && isUnnamed(customer.name)) {
    [customer] = await db.update(s.customers).set({ name: callerName }).where(eq(s.customers.id, customer.id)).returning();
  }

  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: brand.id,
      customerId: customer?.id ?? null,
      // A call from the website is a voice call, but not over the phone line.
      channel: opts.brandId ? "web_chat" : "phone",
      status: "live",
      // Left unset: the classifier names it from the transcript when the call
      // ends, the same way it does for every other conversation.
      intent: null,
      isTest: opts.isTest ?? true,
      agentVersionId: config.versionId,
      startedAt: new Date(),
    })
    .returning();

  return {
    brand,
    config,
    customer: customer ?? null,
    isNewCaller: !customer || isUnnamed(customer.name),
    conversation,
  };
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

/**
 * Did the agent talk about a tool instead of using one?
 *
 * A live model occasionally narrates — "calls take_action, I have requested
 * the fee be waived" — rather than emitting the function call. The caller
 * hears a promise, the ceiling is never consulted, and nothing is recorded.
 * The instruction above tells it not to; this catches the times that is not
 * enough, because a guardrail that depends on the model choosing to cooperate
 * is not a guardrail.
 *
 * Detection only. It cannot un-say what the caller heard, but it puts the turn
 * in front of whoever reviews quality instead of letting it pass silently.
 */
const TOOL_NAMES = [
  "search_knowledge",
  "take_action",
  "escalate_to_human",
  "save_caller_details",
  "schedule_follow_up",
];

export function narratedATool(said: string): string | null {
  const lower = said.toLowerCase();
  const named = TOOL_NAMES.find((t) => lower.includes(t));
  if (named) return named;
  // The shapes it uses when it paraphrases rather than names.
  if (/\b(calling|calls|invoking|using) (the )?(tool|function)\b/.test(lower)) return "a tool";
  return null;
}

/** Record a narrated tool call as the quality failure it is. */
export async function flagNarration(brandId: string, turnBody: string, tool: string) {
  const [brand] = await db
    .select({ orgId: s.brands.orgId })
    .from(s.brands)
    .where(eq(s.brands.id, brandId))
    .limit(1);
  if (!brand) return;

  await db.insert(s.qualityFlags).values({
    orgId: brand.orgId,
    failureClass: "narrated_tool_call",
    summary: `Said "${tool}" aloud instead of invoking it: "${turnBody.slice(0, 140)}"`,
    rootCause: "The model described the call rather than emitting it, so no ceiling was checked",
    owner: "corva",
    status: "open",
  });
}
