import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { priceUsage, type Usage } from "@/lib/pricing";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * The nightly rollups.
 *
 * Three tables the console reads constantly and nothing was writing outside the
 * seed: `usage_daily` (every operator chart), `organizations.health_score` (the
 * fleet sorts by it), and `documents.success_rate` (the knowledge screen ranks
 * by it). Denormalised on purpose — the alternative is scanning the whole
 * conversation graph on the operator console's front page — which is exactly
 * why they need a job that keeps them true.
 *
 * All three are idempotent. Re-running a day recomputes it rather than adding
 * to it, so a failed run is fixed by running it again.
 */

const midnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Cost is summed from the conversations themselves rather than re-derived
 * from their duration. Two guesses at a rate card used to live here and in
 * `analytics.ts`, and they disagreed; now both read what was measured.
 */

/**
 * Recompute `usage_daily` for a span of days.
 *
 * Grouped in SQL rather than in memory: this is the one job whose input grows
 * without bound, and pulling a fleet-week of conversations into Node to count
 * them is the version that works until it does not.
 *
 * The double `at time zone 'utc'` is load-bearing and easy to lose. The first
 * makes the day boundary UTC; the second converts the result back to a
 * timestamptz, because Postgres otherwise re-reads that bare timestamp in the
 * session's timezone on insert. On a machine in Asia/Kolkata that wrote every
 * key at 18:30Z rather than midnight, so the upsert never matched and each day
 * silently gained a second row — doubling every operator chart summing this
 * table.
 */
export async function rollUpUsage(days = 2): Promise<{ rows: number; days: number }> {
  const from = midnight(new Date(Date.now() - days * 864e5));

  const grouped = await db
    .select({
      orgId: s.brands.orgId,
      day: sql<string>`(date_trunc('day', ${s.conversations.startedAt} at time zone 'utc') at time zone 'utc')`,
      conversations: sql<number>`count(*)::int`,
      contained: sql<number>`count(*) filter (where ${s.conversations.contained})::int`,
      handoffs: sql<number>`count(*) filter (where ${s.conversations.contained} is false)::int`,
      aiSeconds: sql<number>`coalesce(sum(${s.conversations.durationSeconds}) filter (where ${s.conversations.contained}), 0)::int`,
      humanSeconds: sql<number>`coalesce(sum(${s.conversations.durationSeconds}) filter (where ${s.conversations.contained} is false), 0)::int`,
      costPaise: sql<number>`coalesce(sum(${s.conversations.costPaise}), 0)`,
    })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    // Rehearsals never reach usage, and therefore never reach fleet health,
    // revenue or unit economics, all of which read this table.
    .where(and(gte(s.conversations.startedAt, from), eq(s.conversations.isTest, false)))
    .groupBy(s.brands.orgId, sql`(date_trunc('day', ${s.conversations.startedAt} at time zone 'utc') at time zone 'utc')`);

  if (grouped.length === 0) return { rows: 0, days };

  const values = grouped.map((g) => {
    const aiMinutes = Math.round(g.aiSeconds / 60);
    const humanMinutes = Math.round(g.humanSeconds / 60);
    return {
      orgId: g.orgId,
      day: new Date(g.day),
      conversations: g.conversations,
      contained: g.contained,
      handoffs: g.handoffs,
      aiMinutes,
      humanMinutes,
      costPaise: Math.round(Number(g.costPaise)),
    };
  });

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(s.usageDaily)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [s.usageDaily.orgId, s.usageDaily.day],
        set: {
          conversations: sql`excluded.conversations`,
          contained: sql`excluded.contained`,
          handoffs: sql`excluded.handoffs`,
          aiMinutes: sql`excluded.ai_minutes`,
          humanMinutes: sql`excluded.human_minutes`,
          costPaise: sql`excluded.cost_paise`,
        },
      });
  }

  return { rows: values.length, days };
}

/**
 * Recompute every tenant's health score.
 *
 * Health is containment over the last 30 days, bounded away from 0 and 100 —
 * a tenant with three conversations should not read as perfect, and one with a
 * bad week should not read as dead. Tenants with no traffic keep whatever they
 * had rather than being scored on nothing.
 */
export async function recomputeHealth(): Promise<{ updated: number; skipped: number }> {
  const rows = await db
    .select({
      orgId: s.usageDaily.orgId,
      total: sql<number>`coalesce(sum(${s.usageDaily.conversations}), 0)::int`,
      contained: sql<number>`coalesce(sum(${s.usageDaily.contained}), 0)::int`,
    })
    .from(s.usageDaily)
    .where(gte(s.usageDaily.day, new Date(Date.now() - 30 * 864e5)))
    .groupBy(s.usageDaily.orgId);

  // Fewer than ten conversations is not evidence of anything.
  const scored = rows
    .filter((r) => r.total >= 10)
    .map((r) => ({
      orgId: r.orgId,
      health: Math.max(5, Math.min(99, Math.round((r.contained / r.total) * 100))),
    }));

  if (scored.length === 0) return { updated: 0, skipped: rows.length };

  // One statement, not one per tenant. The fleet is 148 rows today and the
  // round trips to a remote database cost 47s; as a single UPDATE ... FROM it
  // is one.
  const values = sql.join(
    scored.map((r) => sql`(${r.orgId}::uuid, ${r.health}::int)`),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE ${s.organizations} AS o
    SET health_score = v.health
    FROM (VALUES ${values}) AS v(org_id, health)
    WHERE o.id = v.org_id
  `);

  return { updated: scored.length, skipped: rows.length - scored.length };
}

/**
 * Recompute how often each document is cited and how well it does.
 *
 * "Success" is the share of conversations citing a document that the AI then
 * finished alone. It is the number the knowledge screen sorts by, and it is the
 * only signal that separates a document that gets read from one that works.
 */
export async function recomputeDocumentStats(): Promise<{ documents: number }> {
  const rows = await db
    .select({
      documentId: s.turnCitations.documentId,
      citations: sql<number>`count(*)::int`,
      conversations: sql<number>`count(distinct ${s.turns.conversationId})::int`,
      contained: sql<number>`count(distinct ${s.turns.conversationId}) filter (where ${s.conversations.contained})::int`,
    })
    .from(s.turnCitations)
    .innerJoin(s.turns, eq(s.turns.id, s.turnCitations.turnId))
    .innerJoin(s.conversations, eq(s.conversations.id, s.turns.conversationId))
    .where(eq(s.conversations.isTest, false))
    .groupBy(s.turnCitations.documentId);

  const scored = rows.filter((r) => r.documentId !== null);
  if (scored.length === 0) return { documents: 0 };

  // A document nobody has finished a conversation with has no rate yet, which
  // is different from a rate of zero — hence the null rather than 0.
  const values = sql.join(
    scored.map(
      (r) =>
        sql`(${r.documentId}::uuid, ${r.citations}::int, ${
          r.conversations > 0 ? r.contained / r.conversations : null
        }::real)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE ${s.documents} AS d
    SET citation_count = v.citations, success_rate = v.rate
    FROM (VALUES ${values}) AS v(doc_id, citations, rate)
    WHERE d.id = v.doc_id
  `);

  return { documents: scored.length };
}

/**
 * Delete transcripts past each tenant's stated retention.
 *
 * The Setup screen promises "transcripts are deleted after N days" and, until
 * this ran, nothing deleted anything — the setting was a label. Turns go and
 * the conversation row stays, so the counts the tenant has already been shown
 * do not silently change; what is removed is the content, which is what the
 * promise was about.
 */
export async function enforceRetention(): Promise<{ orgs: number; conversations: number }> {
  const settings = await db
    .select({ orgId: s.privacySettings.orgId, retentionDays: s.privacySettings.retentionDays })
    .from(s.privacySettings);

  let orgs = 0;
  let conversations = 0;

  for (const setting of settings) {
    const cutoff = new Date(Date.now() - setting.retentionDays * 864e5);

    const stale = await db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
      .where(and(eq(s.brands.orgId, setting.orgId), lt(s.conversations.startedAt, cutoff)));

    if (stale.length === 0) continue;

    for (let i = 0; i < stale.length; i += 200) {
      const batch = stale.slice(i, i + 200).map((c) => c.id);
      await db.delete(s.turns).where(inArray(s.turns.conversationId, batch));
    }

    await db.insert(s.auditLog).values({
      orgId: setting.orgId,
      actorType: "system",
      actorId: "retention",
      actorName: "Retention policy",
      action: "transcripts.deleted",
      target: `${stale.length} conversations`,
      meta: { retentionDays: setting.retentionDays, before: cutoff.toISOString() },
    });

    orgs++;
    conversations += stale.length;
  }

  return { orgs, conversations };
}

/**
 * Price conversations that were never metered.
 *
 * Everything recorded before the meter existed, and anything seeded, carries a
 * cost of zero — which would make the spend figures read as free rather than
 * as unknown. This reconstructs a defensible figure from what the row does
 * hold: transcript length as a token proxy, duration as audio time on voice,
 * and the gap between a handover and the end of the call as a person's time.
 *
 * The breakdown is marked `estimated` so nobody later mistakes a reconstruction
 * for a measurement. Live traffic is metered properly and never comes here.
 */
export async function backfillCosts(limit = 2000): Promise<{ priced: number }> {
  const pending = await db
    .select({
      id: s.conversations.id,
      channel: s.conversations.channel,
      duration: s.conversations.durationSeconds,
      contained: s.conversations.contained,
      modelId: s.conversations.modelId,
    })
    .from(s.conversations)
    .where(eq(s.conversations.costPaise, 0))
    .limit(limit);

  if (pending.length === 0) return { priced: 0 };

  const turns = await db
    .select({
      conversationId: s.turns.conversationId,
      speaker: s.turns.speaker,
      body: s.turns.body,
    })
    .from(s.turns)
    .where(inArray(s.turns.conversationId, pending.map((p) => p.id)));

  const byConversation = new Map<string, typeof turns>();
  for (const t of turns) {
    const list = byConversation.get(t.conversationId) ?? [];
    list.push(t);
    byConversation.set(t.conversationId, list);
  }

  const values: { id: string; paise: number; breakdown: unknown }[] = [];
  for (const c of pending) {
    const rows = byConversation.get(c.id) ?? [];
    if (rows.length === 0) continue;

    // Four characters to a token is the usual rough conversion, and the
    // prompt is far larger than the reply — persona, ceilings and retrieved
    // documents all ride along on every turn.
    const promptChars = rows.reduce((a, t) => a + t.body.length, 0);
    const aiTurns = rows.filter((t) => t.speaker === "ai");
    const outputChars = aiTurns.reduce((a, t) => a + t.body.length, 0);

    const usage: Usage = {
      inputTokens: Math.ceil((promptChars + aiTurns.length * 2000) / 4),
      outputTokens: Math.ceil(outputChars / 4),
      embeddingTokens: Math.ceil(promptChars / 4),
    };

    if (c.channel === "phone" && c.duration) {
      // Roughly half the call is each party speaking.
      usage.audioInSeconds = c.duration * 0.45;
      usage.audioOutSeconds = c.duration * 0.45;
    }
    if (c.contained === false && c.duration) {
      // A conversation a person had to take cost some of their time; without
      // turn timestamps to bound it, a third of the call is the honest guess.
      usage.humanSeconds = Math.round(c.duration / 3);
    }

    // Rows from before the choice existed carry no model, and price at the
    // default's rates — which is the right answer for a reconstruction that is
    // already marked `estimated`.
    const cost = priceUsage(usage, c.modelId);
    values.push({
      id: c.id,
      paise: cost.paise,
      breakdown: { usage, lines: cost.lines, estimated: true },
    });
  }

  for (let i = 0; i < values.length; i += 400) {
    const batch = values.slice(i, i + 400);
    const rows = sql.join(
      batch.map((v) => sql`(${v.id}::uuid, ${v.paise}::real, ${JSON.stringify(v.breakdown)}::jsonb)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE ${s.conversations} AS c
      SET cost_paise = v.paise, cost_breakdown = v.breakdown
      FROM (VALUES ${rows}) AS v(id, paise, breakdown)
      WHERE c.id = v.id
    `);
  }

  return { priced: values.length };
}

/**
 * Close calls that stopped happening.
 *
 * A conversation is only live while someone is on it. Nothing guaranteed that
 * before: a bridge that crashed, a browser that closed without a clean
 * disconnect, or a seeded fixture would leave a row marked `live` for ever —
 * and the live console shows the newest live conversation, so one stale row
 * hides every real call placed afterwards.
 *
 * Staleness is measured from the last turn rather than from the start, because
 * a long call with someone still talking is not stale.
 */
const CALL_IDLE_MINUTES = 15;
const CHAT_IDLE_MINUTES = 60;

export async function reapStaleCalls(): Promise<{ closed: number }> {
  // The moment it last moved: its newest turn, or its start if nobody spoke.
  const lastMoved = sql`coalesce(
    (select max(created_at) from ${s.turns} where conversation_id = ${s.conversations.id}),
    ${s.conversations.startedAt}
  )`;
  const rows = await db
    .update(s.conversations)
    // Ended when it went quiet, not when this job happened to run.
    .set({ status: "abandoned", endedAt: lastMoved })
    .where(
      and(
        eq(s.conversations.status, "live"),
        // A call that has gone quiet is over. Someone typing may step away and
        // come back, so a chat is given longer.
        sql`${lastMoved} < now() - (case when ${s.conversations.channel} = 'phone' then ${CALL_IDLE_MINUTES} else ${CHAT_IDLE_MINUTES} end || ' minutes')::interval`,
      ),
    )
    .returning({ id: s.conversations.id });
  return { closed: rows.length };
}
