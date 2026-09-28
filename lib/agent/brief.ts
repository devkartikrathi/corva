import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { AgentConfig } from "./config";
import { assignHandoff } from "./routing";
import { languageModel, thinkingOptions } from "./model";
import { resolveModel } from "./models";
import { recordModelCall } from "./quota";

/**
 * The handoff brief.
 *
 * The design's promise is that "no customer is asked to explain themselves
 * twice" — so the brief is not a transcript link. It states what the customer
 * wants, what was already done, and isolates the single decision left, which
 * is the only thing the human actually has to supply.
 */

const BriefSchema = z.object({
  headline: z
    .string()
    .describe(
      "One line, under 140 characters, that a colleague can read while the customer is " +
        "still on the line. What they want and where it stuck, in that order.",
    ),
  wants: z
    .string()
    .describe("What the customer is asking for, in one or two sentences, concretely."),
  alreadyDid: z
    .array(z.object({ ok: z.boolean(), text: z.string() }))
    .describe("What the AI did (ok: true) and pointedly did not do (ok: false)."),
  decision: z
    .string()
    .describe("The single decision the human must make, phrased as a question."),
  decisionContext: z
    .string()
    .describe("The facts that bear on that decision, including what policy allows."),
  openingLine: z
    .string()
    .describe("A first sentence the human can say, showing they have read everything."),
  sensitivities: z
    .string()
    .describe("Anything that would make this worse if the human got it wrong."),
});

export type Brief = z.infer<typeof BriefSchema>;

export async function writeBrief(opts: {
  conversationId: string;
  brandId: string;
  config: AgentConfig;
  reason: string;
  customerContext: string;
  transcript: string[];
  blockedAction: string | null;
  /**
   * Why a person is being pulled in.
   *
   * `escalation` is the AI hitting a limit. `closure_approval` is the opposite:
   * the customer was told no, accepted it, and the conversation ended by
   * agreement — nothing is owed, but somebody still signs it off.
   */
  kind?: "escalation" | "closure_approval";
}) {
  const {
    conversationId,
    brandId,
    config,
    reason,
    customerContext,
    transcript,
    blockedAction,
    kind = "escalation",
  } = opts;

  const actions = await db
    .select()
    .from(s.conversationActions)
    .where(eq(s.conversationActions.conversationId, conversationId));

  // The brand's model, thinking harder than it does on a live turn: a brief is
  // read by a colleague picking up an unhappy customer, and nobody is waiting
  // on it in silence.
  const model = resolveModel(config.modelId);

  const { object: brief, usage: briefUsage } = await generateObject({
    model: languageModel(model.id),
    providerOptions: thinkingOptions(model.thinking.analysis),
    schema: BriefSchema,
    system: `You write handoff briefs for ${config.brandName}. A human agent will read
your brief instead of the transcript, then pick up a live customer.
${
      kind === "closure_approval"
        ? `This one is a closure, not an escalation. The customer asked for something the
AI could not give, was told so plainly, and accepted it. Nobody has to fix
anything — they have to confirm that ending it there was right. Write the
decision as "Confirm this was closed correctly?" rather than as a request.`
        : ""
    }

Be concrete and short. Name amounts, order references and policy sections.
Never invent a fact that is not in the material given to you. The point of the
brief is that the customer does not have to repeat themselves, so anything
they said that the human would otherwise ask for must be in it.`,
    prompt: `The AI stopped and escalated. Reason: ${reason}
${blockedAction ? `The AI was refused an action: ${blockedAction}` : ""}

Customer:
${customerContext}

Actions taken this conversation:
${actions.map((a) => `- ${a.label} (${a.allowed ? "applied" : "refused"})`).join("\n") || "- none"}

Transcript:
${transcript.join("\n")}`,
  });

  await recordModelCall(model.id, briefUsage);

  const [row] = await db
    .insert(s.handoffs)
    .values({ conversationId, brandId, kind, reason, brief, headline: brief.headline })
    .returning();

  // The headline doubles as the conversation's live summary. It is the freshest
  // one-line account of the call that exists at this moment, and writing it here
  // saves a second model call at exactly the point where a person is waiting.
  await db
    .update(s.conversations)
    .set({ liveSummary: brief.headline, liveSummaryAt: new Date() })
    .where(eq(s.conversations.id, conversationId));

  // Ring it at somebody. A queue nobody is named on is a queue everyone
  // assumes someone else is working — see lib/agent/routing.ts.
  const routing = await assignHandoff(row.id);

  return { ...row, routedTo: routing };
}
