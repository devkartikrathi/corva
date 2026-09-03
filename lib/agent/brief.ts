import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { AgentConfig } from "./config";
import { ANALYSIS_MODEL, ANALYSIS_THINKING } from "./model";

/**
 * The handoff brief.
 *
 * The design's promise is that "no customer is asked to explain themselves
 * twice" — so the brief is not a transcript link. It states what the customer
 * wants, what was already done, and isolates the single decision left, which
 * is the only thing the human actually has to supply.
 */

const BriefSchema = z.object({
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
}) {
  const { conversationId, brandId, config, reason, customerContext, transcript, blockedAction } =
    opts;

  const actions = await db
    .select()
    .from(s.conversationActions)
    .where(eq(s.conversationActions.conversationId, conversationId));

  const { object: brief } = await generateObject({
    model: ANALYSIS_MODEL,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: ANALYSIS_THINKING } } },
    schema: BriefSchema,
    system: `You write handoff briefs for ${config.brandName}. A human agent will read
your brief instead of the transcript, then pick up a live customer.

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

  const [row] = await db
    .insert(s.handoffs)
    .values({ conversationId, brandId, reason, brief })
    .returning();

  return row;
}
