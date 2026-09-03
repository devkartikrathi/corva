import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Metrics for the analytics screen and the command centre's headline strip.
 *
 * Everything here is computed from the conversation graph rather than stored,
 * so a screen can never quote a number the underlying rows would contradict.
 */

const ACCENT_700 = "var(--color-accent-700)";
const N_800 = "var(--color-neutral-800)";

/** Human cost of one escalated contact, used to price documentation gaps. */
const HUMAN_COST_PENCE = 490;
const AI_COST_PENCE = 68;

export async function getBrandMetrics(brandId: string) {
  const rows = await db
    .select({
      status: s.conversations.status,
      outcome: s.conversations.outcome,
      contained: s.conversations.contained,
      channel: s.conversations.channel,
      duration: s.conversations.durationSeconds,
      sentimentEnd: s.conversations.sentimentEnd,
      startedAt: s.conversations.startedAt,
      reviewScore: s.conversations.reviewScore,
    })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brandId));

  const total = rows.length;
  const contained = rows.filter((r) => r.contained === true).length;
  const escalated = rows.filter((r) => r.contained === false).length;
  const containment = total ? (contained / total) * 100 : 0;

  const durations = rows.map((r) => r.duration).filter((d): d is number => d !== null);
  const avgHandle = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const sentiments = rows.map((r) => r.sentimentEnd).filter((x): x is number => x !== null);
  const avgSentiment = sentiments.length
    ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
    : 0;

  const reviews = rows.map((r) => r.reviewScore).filter((x): x is number => x !== null);
  const avgReview = reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : null;

  // Blended cost: contained contacts cost the AI rate, escalations the human one.
  const costPer =
    total > 0 ? (contained * AI_COST_PENCE + escalated * HUMAN_COST_PENCE) / total : 0;

  const waiting = rows.filter((r) => r.status === "waiting_human").length;
  const live = rows.filter((r) => r.status === "live").length;

  const channelCounts = new Map<string, number>();
  for (const r of rows) channelCounts.set(r.channel, (channelCounts.get(r.channel) ?? 0) + 1);

  return {
    total,
    contained,
    escalated,
    containment,
    avgHandleSeconds: avgHandle,
    avgSentiment,
    avgReview,
    costPerContactPence: Math.round(costPer),
    waiting,
    live,
    channelMix: [...channelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({
        name: name === "web_chat" ? "Web chat" : name[0].toUpperCase() + name.slice(1),
        share: total ? `${Math.round((n / total) * 100)}%` : "0%",
        primary: n === Math.max(...channelCounts.values()),
      })),
  };
}

/** Contacts per hour today, split AI vs human, for the volume chart. */
export async function hourlyVolume(brandId: string) {
  const rows = await db
    .select({ startedAt: s.conversations.startedAt, contained: s.conversations.contained })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brandId));

  const buckets = Array.from({ length: 14 }, () => ({ ai: 0, human: 0 }));
  for (const r of rows) {
    // 08:00 → 21:00, the window the chart labels.
    const hour = r.startedAt.getHours();
    if (hour < 8 || hour > 21) continue;
    const bucket = buckets[hour - 8];
    if (r.contained === false) bucket.human++;
    else bucket.ai++;
  }

  const peak = Math.max(1, ...buckets.map((b) => b.ai + b.human));
  return buckets.map((b) => ({
    ai: `${Math.round((b.ai / peak) * 90)}%`,
    human: `${Math.round((b.human / peak) * 90)}%`,
  }));
}

/** Weekly containment for the analytics chart. */
export async function weeklyContainment(brandId: string, weeks = 12) {
  const since = new Date(Date.now() - weeks * 7 * 864e5);
  const rows = await db
    .select({ startedAt: s.conversations.startedAt, contained: s.conversations.contained })
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brandId), gte(s.conversations.startedAt, since)));

  const buckets = Array.from({ length: weeks }, () => ({ ai: 0, human: 0 }));
  for (const r of rows) {
    const weeksAgo = Math.floor((Date.now() - r.startedAt.getTime()) / (7 * 864e5));
    const idx = weeks - 1 - Math.min(weeks - 1, weeksAgo);
    if (r.contained === false) buckets[idx].human++;
    else buckets[idx].ai++;
  }

  return buckets.map((b) => {
    const n = b.ai + b.human;
    return {
      ai: n ? `${Math.round((b.ai / n) * 80)}%` : "0%",
      human: n ? `${Math.round((b.human / n) * 80)}%` : "0%",
    };
  });
}

/**
 * What the AI still cannot finish, priced.
 *
 * Ranked by what fixing it would return: the number of contacts times the
 * difference between a human contact and an AI one.
 */
export async function unfinishedIntents(brandId: string) {
  const gaps = await db
    .select()
    .from(s.knowledgeGaps)
    .where(eq(s.knowledgeGaps.brandId, brandId))
    .orderBy(desc(s.knowledgeGaps.hits));

  const escalations = await db
    .select({ intent: s.conversations.intent, n: sql<number>`count(*)::int` })
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.contained, false)))
    .groupBy(s.conversations.intent);

  const REASON_LABEL: Record<string, string> = {
    no_document: "No document",
    contradiction: "Contradictory docs",
    authority_ceiling: "Authority ceiling",
    blocked_action: "Blocked action",
  };

  const fromGaps = gaps.map((g) => ({
    name: g.intent,
    calls: String(g.hits),
    reason: REASON_LABEL[g.reason] ?? g.reason,
    cost: `£${(((g.hits * (HUMAN_COST_PENCE - AI_COST_PENCE)) / 100) * 4).toFixed(0)} / mo`,
    fix: g.reason === "no_document" ? "Draft policy" : "Resolve conflict",
    bad: true,
    to: "/app/knowledge",
    reasonColor: ACCENT_700,
  }));

  const fromEscalations = escalations
    .filter((e) => e.intent && !gaps.some((g) => g.intent === e.intent))
    .map((e) => ({
      name: e.intent!,
      calls: String(e.n),
      reason: "Beyond authority",
      cost: `£${(((e.n * (HUMAN_COST_PENCE - AI_COST_PENCE)) / 100) * 4).toFixed(0)} / mo`,
      fix: "Raise ceiling",
      bad: false,
      to: "/app/tuning",
      reasonColor: N_800,
    }));

  return [...fromGaps, ...fromEscalations].slice(0, 8);
}

/** Citation and guardrail quality, from the turn graph. */
export async function qualityMetrics(brandId: string) {
  const [aiTurns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.turns)
    .innerJoin(s.conversations, eq(s.conversations.id, s.turns.conversationId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.turns.speaker, "ai")));

  const [cited] = await db
    .select({ n: sql<number>`count(DISTINCT ${s.turnCitations.turnId})::int` })
    .from(s.turnCitations)
    .innerJoin(s.turns, eq(s.turns.id, s.turnCitations.turnId))
    .innerJoin(s.conversations, eq(s.conversations.id, s.turns.conversationId))
    .where(eq(s.conversations.brandId, brandId));

  const [refused] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversationActions)
    .innerJoin(s.conversations, eq(s.conversations.id, s.conversationActions.conversationId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversationActions.allowed, false)));

  const [reviewed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brandId), sql`${s.conversations.reviewScore} IS NOT NULL`));

  const rate = aiTurns.n ? (cited.n / aiTurns.n) * 100 : 0;

  return [
    { label: "Answers with a citation", value: `${rate.toFixed(1)}%`, hot: rate < 90 },
    { label: "AI turns recorded", value: String(aiTurns.n), hot: false },
    { label: "Actions refused by a ceiling", value: String(refused.n), hot: refused.n > 0 },
    { label: "Conversations reviewed", value: String(reviewed.n), hot: false },
  ];
}

/** Per-agent handling stats for the analytics rail. */
export async function agentPerformance(orgId: string) {
  const rows = await db
    .select({
      name: s.memberships.name,
      role: s.memberships.role,
      handled: sql<number>`count(${s.handoffs.id})::int`,
    })
    .from(s.memberships)
    .leftJoin(s.handoffs, eq(s.handoffs.acceptedByMembershipId, s.memberships.id))
    .where(eq(s.memberships.orgId, orgId))
    .groupBy(s.memberships.id, s.memberships.name, s.memberships.role)
    .orderBy(desc(sql`count(${s.handoffs.id})`));

  return rows.slice(0, 5).map((r) => ({
    name: r.name,
    role: r.role[0].toUpperCase() + r.role.slice(1),
    handled: String(r.handled),
    aht: "—",
    csat: "—",
    csatColor: N_800,
  }));
}
