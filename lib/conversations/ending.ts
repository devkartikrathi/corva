import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { conversationPayload, emitForConversation } from "@/lib/integrations/webhooks";

/**
 * Ending a conversation that has no one left in it.
 *
 * A call ends when the line drops; a chat has no such moment — the customer
 * closes the tab, reloads, or just stops typing. So a chat is ended when its
 * window says it closed (POST /api/v1/chat/end), when the same browser starts
 * a new one, or when it has been quiet long enough: 30 minutes for a website
 * chat, 15 for a call, 24 hours on WhatsApp (WhatsApp's own reply window).
 * Quiet ones are found every minute or so while anyone has Corva open, not
 * once a day.
 *
 * Every ended conversation gets the same close as a call: resolved if the
 * customer said anything (abandoned if not), when it ended and how long it
 * took, uncontained if a person had to step in, then the classifier's
 * summary, intent and outcome.
 */

const IDLE_MINUTES = { phone: 15, web_chat: 30, whatsapp: 24 * 60, sms: 30, survey: 30 } as const;

/** When it last moved: its newest turn, or its start if nobody spoke. */
const lastMoved = sql`coalesce(
  (select max(created_at) from turns where conversation_id = conversations.id),
  conversations.started_at
)`;

/** End one conversation. Does nothing to one already over, or waiting for a person. */
export async function endConversation(conversationId: string, opts: { at?: Date; classify?: boolean } = {}) {
  const [c] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!c || (c.status !== "live" && c.status !== "waiting_human")) return false;
  const turns = await db.select({ speaker: s.turns.speaker, at: s.turns.createdAt }).from(s.turns).where(eq(s.turns.conversationId, conversationId));
  const endedAt = opts.at ?? new Date();
  const seconds = Math.max(0, Math.round((endedAt.getTime() - c.startedAt.getTime()) / 1000));

  // Still queued for a person: the customer leaving does not settle what needed someone.
  if (c.status === "waiting_human") {
    await db.update(s.conversations).set({ endedAt, durationSeconds: seconds }).where(eq(s.conversations.id, conversationId));
    return true;
  }

  const humanSpoke = turns.some((t) => t.speaker === "human") || Boolean(c.handledBy);
  const exchanged = turns.some((t) => t.speaker === "customer");
  const [refused] = await db
    .select({ id: s.conversationActions.id })
    .from(s.conversationActions)
    .where(and(eq(s.conversationActions.conversationId, conversationId), eq(s.conversationActions.allowed, false)))
    .limit(1);
  await db
    .update(s.conversations)
    .set({
      status: exchanged ? "resolved" : "abandoned",
      endedAt,
      durationSeconds: c.durationSeconds ?? seconds,
      contained: humanSpoke || refused ? false : c.contained,
      outcome: c.outcome ?? (humanSpoke ? "human_resolved" : null),
    })
    .where(and(eq(s.conversations.id, conversationId), inArray(s.conversations.status, ["live"])));
  emitForConversation(conversationId, "conversation.ended", () => conversationPayload(conversationId));

  if (exchanged && opts.classify !== false && !c.summary) {
    const { classifyAndStore } = await import("@/lib/pipelines/classify");
    await classifyAndStore(conversationId).catch((e) => console.error("[ending] classify", (e as Error).message));
  }
  return true;
}

/** The browser started a new chat: the ones it left open are over. */
export async function endEarlierChats(visitorId: string, keep: string) {
  const open = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(and(eq(s.conversations.visitorId, visitorId), eq(s.conversations.channel, "web_chat"), eq(s.conversations.status, "live"), sql`${s.conversations.id} <> ${keep}`))
    .orderBy(desc(s.conversations.startedAt))
    .limit(10);
  for (const { id } of open) await endConversation(id);
  return open.length;
}

let lastSweep = 0;

/**
 * End every conversation that has gone quiet. Cheap enough to call on any
 * console page load; runs at most once a minute per server. The first few it
 * ends are classified straight away; the rest are by the next run.
 */
export async function endQuietConversations(opts: { force?: boolean; classify?: number } = {}) {
  if (!opts.force && Date.now() - lastSweep < 60_000) return { ended: 0 };
  lastSweep = Date.now();
  const quiet = await db
    .select({ id: s.conversations.id, at: sql<Date>`${lastMoved}` })
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.status, "live"),
        sql`${lastMoved} < now() - (case ${s.conversations.channel}
          when 'phone' then ${IDLE_MINUTES.phone}
          when 'whatsapp' then ${IDLE_MINUTES.whatsapp}
          else ${IDLE_MINUTES.web_chat} end || ' minutes')::interval`,
      ),
    )
    .limit(200);
  let classified = 0;
  for (const q of quiet) {
    const classify = classified < (opts.classify ?? 3);
    if (await endConversation(q.id, { at: new Date(q.at), classify })) classified += classify ? 1 : 0;
  }
  return { ended: quiet.length };
}

/** Ended conversations the classifier has not read yet, for the nightly job. */
export async function classifyEnded(limit = 30) {
  const rows = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(and(inArray(s.conversations.status, ["resolved"]), isNull(s.conversations.summary), sql`exists (select 1 from turns where conversation_id = conversations.id and speaker = 'customer')`))
    .orderBy(desc(s.conversations.startedAt))
    .limit(limit);
  const { classifyAndStore } = await import("@/lib/pipelines/classify");
  for (const { id } of rows) await classifyAndStore(id).catch(() => null);
  return rows.length;
}
