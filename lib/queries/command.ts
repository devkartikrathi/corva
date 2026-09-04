import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { config } from "@/lib/config";
import { getBrandMetrics } from "./analytics";
import { stillLive } from "./live-data";

/**
 * The command centre's read model.
 *
 * The screen answers one question — what needs a person's attention in the
 * next ten minutes — so everything here is either happening now or moved in
 * the last day. Nothing is a rolling average; a metric that smooths over a
 * week cannot answer that question.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_700 = "var(--color-accent-700)";
const N_400 = "var(--color-neutral-400)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const waitLabel = (since: Date) => {
  const mins = Math.max(0, Math.floor((Date.now() - since.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ${mins % 60}m` : `${Math.floor(hours / 24)}d`;
};

/* ─── Headline strip ───────────────────────────────────────────────────── */

export type HeadlineStat = {
  label: string;
  value: string;
  unit?: string;
  note: string;
  strong?: string;
  accent?: boolean;
};

/**
 * The five numbers across the top.
 *
 * Each carries its own second line explaining what it is measured against,
 * because a containment rate with no denominator is a number you cannot act
 * on. Where there is no history to compare with, the line says so rather than
 * inventing a delta.
 */
export async function headlineStats(brandId: string): Promise<HeadlineStat[]> {
  const dayAgo = new Date(Date.now() - 864e5);
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5);

  const [metrics, now, priorityRow, previous] = await Promise.all([
    getBrandMetrics(brandId, { from: dayAgo }),
    // Live and waiting are states, not measurements of a window: a call that
    // has been waiting since yesterday is still waiting.
    getBrandMetrics(brandId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.customerScores)
      .innerJoin(s.customers, eq(s.customers.id, s.customerScores.customerId))
      .where(
        and(
          eq(s.customers.brandId, brandId),
          gte(s.customerScores.blended, config.accentPriorityThreshold),
          // Only the newest score per customer counts; an old high score is
          // history, not a customer who needs attention now.
          sql`${s.customerScores.computedAt} = (
            select max(cs.computed_at) from ${s.customerScores} cs
            where cs.customer_id = ${s.customerScores.customerId}
          )`,
        ),
      ),
    // The 24 hours before the ones being reported, measured identically.
    getBrandMetrics(brandId, { from: twoDaysAgo, to: dayAgo }),
  ]);

  const priorContainment = previous.total ? previous.containment : null;
  const delta = priorContainment === null ? null : metrics.containment - priorContainment;

  return [
    {
      label: "Contacts · 24h",
      value: String(metrics.total),
      note: `${metrics.contained} finished by the AI, ${metrics.escalated} needed a person`,
    },
    {
      label: "AI containment",
      value: `${Math.round(metrics.containment)}`,
      unit: "%",
      note:
        delta === null
          ? "nothing in the previous 24 hours to compare against"
          : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} points against the 24 hours before`,
      accent: delta !== null && delta < 0,
    },
    {
      label: "Average handle time",
      value: metrics.avgHandleSeconds ? clock(metrics.avgHandleSeconds) : "—",
      note: "across every channel, start to resolution",
    },
    {
      label: "Waiting for a person",
      value: String(now.waiting),
      note: now.live ? `and ${now.live} live right now` : "nothing live right now",
      accent: now.waiting > 0,
    },
    {
      label: `Priority ≥ ${config.accentPriorityThreshold}`,
      value: String(priorityRow[0]?.n ?? 0),
      note: "customers the model puts above the accent threshold",
    },
  ];
}

/* ─── Live right now ───────────────────────────────────────────────────── */

/**
 * Conversations in progress, most urgent first.
 *
 * "Urgent" is the customer's priority score, not the call's age: a two-minute
 * call with a Tier 1 account outranks a twenty-minute one with a new customer,
 * which is the whole reason the scoring model exists.
 */
export async function liveCalls(brandId: string, limit = 3) {
  const rows = await db
    .select({
      id: s.conversations.id,
      intent: s.conversations.intent,
      channel: s.conversations.channel,
      startedAt: s.conversations.startedAt,
      sentimentEnd: s.conversations.sentimentEnd,
      customerId: s.customers.id,
      customerName: s.customers.name,
      tier: s.customers.tier,
    })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.status, "live"), stillLive()))
    .orderBy(asc(s.conversations.startedAt))
    .limit(12);

  const ids = rows.map((r) => r.customerId).filter((id): id is string => !!id);
  const scores = ids.length
    ? await db
        .select({ customerId: s.customerScores.customerId, blended: s.customerScores.blended })
        .from(s.customerScores)
        .where(inArray(s.customerScores.customerId, ids))
        .orderBy(desc(s.customerScores.computedAt))
    : [];
  const scoreBy = new Map<string, number>();
  for (const row of scores) if (!scoreBy.has(row.customerId)) scoreBy.set(row.customerId, row.blended);

  return rows
    .map((r) => {
      const priority = r.customerId ? Math.round(scoreBy.get(r.customerId) ?? 0) : 0;
      const sentiment = r.sentimentEnd ?? 0;
      const elapsed = Math.floor((Date.now() - r.startedAt.getTime()) / 1000);
      return {
        id: r.id,
        customerId: r.customerId,
        name: r.customerName ?? "Unknown caller",
        intent: r.intent ?? "Not yet classified",
        channel: r.channel,
        priority,
        hot: priority >= config.accentPriorityThreshold,
        elapsed: clock(elapsed),
        sentiment: sentiment >= 0 ? `+${sentiment.toFixed(2)}` : sentiment.toFixed(2),
        // −1…+1 mapped onto the bar, so the midpoint is neutral.
        sentimentBar: `${Math.round(((sentiment + 1) / 2) * 100)}%`,
        negative: sentiment < 0,
        tier: r.tier,
      };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/* ─── Right rail ───────────────────────────────────────────────────────── */

/** The handoff queue, compressed to the three that have waited longest. */
export async function needsHuman(brandId: string, limit = 3) {
  const rows = await db
    .select({
      id: s.handoffs.id,
      reason: s.handoffs.reason,
      waitingSince: s.handoffs.waitingSince,
      brief: s.handoffs.brief,
      customerName: s.customers.name,
      intent: s.conversations.intent,
    })
    .from(s.handoffs)
    .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.handoffs.brandId, brandId), eq(s.handoffs.status, "waiting")))
    .orderBy(asc(s.handoffs.waitingSince))
    .limit(limit);

  return rows.map((r) => {
    const waitedMins = (Date.now() - r.waitingSince.getTime()) / 60000;
    return {
      id: r.id,
      name: r.customerName ?? "Unknown caller",
      wait: waitLabel(r.waitingSince),
      note: r.reason || r.intent || "Waiting for a person",
      // Twenty minutes is where the design's queue turns accent.
      urgent: waitedMins >= 20,
    };
  });
}

/** Intents the AI could not answer, most frequent first. */
export async function docGaps(brandId: string, limit = 4) {
  const rows = await db
    .select()
    .from(s.knowledgeGaps)
    .where(eq(s.knowledgeGaps.brandId, brandId))
    .orderBy(desc(s.knowledgeGaps.hits))
    .limit(limit);

  return rows.map((g) => ({
    id: g.id,
    text: g.intent,
    count: g.hits,
    hot: g.hits >= 8,
    cta: g.draftDocumentId ? "Review draft" : g.reason === "contradiction" ? "Reconcile" : "Draft it",
  }));
}

/**
 * Customers whose score moved in the last day.
 *
 * Computed by comparing each customer's newest score against the newest one
 * older than 24 hours — which is only possible because scores are appended
 * rather than updated in place.
 */
export async function scoreMovers(brandId: string, limit = 5) {
  const rows = await db
    .select({
      customerId: s.customerScores.customerId,
      name: s.customers.name,
      blended: s.customerScores.blended,
      breakdown: s.customerScores.breakdown,
      computedAt: s.customerScores.computedAt,
    })
    .from(s.customerScores)
    .innerJoin(s.customers, eq(s.customers.id, s.customerScores.customerId))
    .where(eq(s.customers.brandId, brandId))
    .orderBy(desc(s.customerScores.computedAt));

  const byCustomer = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCustomer.get(row.customerId) ?? [];
    list.push(row);
    byCustomer.set(row.customerId, list);
  }

  const cutoff = Date.now() - 864e5;
  const movers: { id: string; name: string; axis: string; delta: string; hot: boolean; size: number }[] = [];

  for (const [customerId, history] of byCustomer) {
    if (history.length < 2) continue;
    const current = history[0];
    const before = history.find((h) => h.computedAt.getTime() < cutoff) ?? history[history.length - 1];
    const change = Math.round(current.blended - before.blended);
    if (change === 0) continue;

    // Attribute the move to whatever contributed most to the new score — the
    // rule that fired if one did, otherwise the leading axis.
    const breakdown = current.breakdown as {
      contributions?: { axisLabel: string }[];
      rules?: { name: string }[];
    };
    const axis = breakdown.rules?.[0]?.name ?? breakdown.contributions?.[0]?.axisLabel ?? "model";

    movers.push({
      id: customerId,
      name: current.name,
      axis: axis.toLowerCase(),
      delta: `${change > 0 ? "+" : ""}${change}`,
      hot: change > 0,
      size: Math.abs(change),
    });
  }

  return movers.sort((a, b) => b.size - a.size).slice(0, limit);
}

/** Colours for the score-mover and gap rows, kept out of the screen. */
export const colours = { ACCENT, ACCENT_700, N_400, N_700, N_800 };
