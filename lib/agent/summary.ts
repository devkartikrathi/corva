import { asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { languageModel, thinkingOptions } from "./model";
import { resolveModel } from "./models";
import { recordModelCall } from "./quota";

/**
 * One line about a conversation that has not finished yet.
 *
 * The archive's `summary` is written once, when a conversation closes, by the
 * classifier. This is the other half of the same idea and exists for one
 * moment: a colleague is being handed a live customer and has seconds to know
 * what is happening. Twenty turns of transcript is not that, and neither is
 * "Guardrail stop · sentiment below −0.40".
 *
 * Deliberately cheap. It runs on the turn model at low thinking, is capped at
 * one sentence, and is rate-limited by `liveSummaryAt` so a console polling
 * every three seconds cannot turn a summary into a per-second billing line.
 */

/** Don't rewrite a summary that is fresher than this. */
const MIN_INTERVAL_MS = 20_000;

/** Written so it survives being read at a glance, mid-call, by someone busy. */
const SYSTEM = `You write a single line that lets a colleague take over a live
customer conversation without reading it.

Rules:
- One sentence. Under 140 characters. No preamble, no quotes, no full stop needed.
- Say what the customer wants and where it has got stuck, in that order.
- Present tense. Concrete: name the amount, the order, the policy.
- Never invent a fact that is not in the transcript.
- Write it the way a colleague would say it across a desk, not the way a
  report would phrase it. "Wants the ₹7,500 install fee waived after a third
  failed delivery; AI refused, she's asking for a manager" — like that.`;

/**
 * Rewrite a conversation's live summary.
 *
 * Returns the line, or null when there was nothing to summarise — a
 * conversation with no customer turn has not started, and a made-up summary of
 * it would be worse than none.
 *
 * `force` skips the rate limit, for the one place it matters: the moment a
 * handoff is raised, where a twenty-second-old line is the wrong line.
 */
export async function updateLiveSummary(
  conversationId: string,
  { force = false }: { force?: boolean } = {},
): Promise<string | null> {
  const [conversation] = await db
    .select({
      liveSummary: s.conversations.liveSummary,
      liveSummaryAt: s.conversations.liveSummaryAt,
      intent: s.conversations.intent,
      modelId: s.brands.modelId,
    })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conversation) return null;

  if (
    !force &&
    conversation.liveSummaryAt &&
    Date.now() - conversation.liveSummaryAt.getTime() < MIN_INTERVAL_MS
  ) {
    return conversation.liveSummary;
  }

  const turns = await db
    .select({ speaker: s.turns.speaker, authorName: s.turns.authorName, body: s.turns.body })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  if (!turns.some((t) => t.speaker === "customer")) return null;

  const actions = await db
    .select({ label: s.conversationActions.label, allowed: s.conversationActions.allowed })
    .from(s.conversationActions)
    .where(eq(s.conversationActions.conversationId, conversationId));

  // The brand's model at its live-turn thinking depth. This is the most
  // frequent model call the product makes — once every twenty seconds per open
  // conversation — so on a rationed model it is also the one most likely to be
  // what exhausts the day. The counter records it like any other request.
  const model = resolveModel(conversation.modelId);

  const { text, usage } = await generateText({
    model: languageModel(model.id),
    providerOptions: thinkingOptions(model.thinking.turn),
    system: SYSTEM,
    prompt: [
      conversation.intent ? `Opened as: ${conversation.intent}` : "",
      actions.length
        ? `Actions attempted: ${actions.map((a) => `${a.label} (${a.allowed ? "applied" : "refused"})`).join("; ")}`
        : "",
      "",
      "Transcript so far:",
      // The last dozen turns: a long call's opening is context the brief
      // carries, and paying to re-read all of it every twenty seconds is not
      // what this line is for.
      ...turns.slice(-12).map((t) => `${t.authorName ?? t.speaker}: ${t.body}`),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  await recordModelCall(model.id, usage);

  const line = text.trim().replace(/^["“]|["”]$/g, "").slice(0, 200);
  if (!line) return conversation.liveSummary;

  await db
    .update(s.conversations)
    .set({ liveSummary: line, liveSummaryAt: new Date() })
    .where(eq(s.conversations.id, conversationId));

  return line;
}

/**
 * The same line, but never generating one.
 *
 * Used by anything on a read path — the live console, the transfer alert —
 * which must not turn a page render into a model call. It falls back through
 * what is already written down rather than showing a colleague nothing.
 */
export function fallbackSummary(conversation: {
  liveSummary: string | null;
  summary: string | null;
  intent: string | null;
}): string | null {
  return conversation.liveSummary ?? conversation.summary ?? conversation.intent ?? null;
}
