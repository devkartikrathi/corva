import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { formatRupees } from "@/lib/money";
import { realTraffic } from "./live-data";

/**
 * Metrics for the analytics screen and the command centre's headline strip.
 *
 * Everything here is computed from the conversation graph rather than stored,
 * so a screen can never quote a number the underlying rows would contradict.
 */

const ACCENT_700 = "var(--color-accent-700)";
const N_800 = "var(--color-neutral-800)";

/**
 * What an unanswered intent is worth fixing.
 *
 * Pricing a documentation gap needs the *difference* between a contact a
 * person had to take and one the AI finished, and that difference is now
 * measured: `costOfContact` reads it back off the conversations themselves
 * rather than assuming a flat rate. The constants that used to live here
 * disagreed with the ones in the rollup.
 */

/**
 * @param window Restrict to a time span. The command centre asks for the last
 * 24 hours and compares it against the 24 before that; analytics asks for
 * everything. Passing a span here rather than filtering the result keeps the
 * two ends of a comparison measured the same way.
 */
export async function getBrandMetrics(brandId: string, window?: { from: Date; to?: Date }) {
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
      costPaise: s.conversations.costPaise,
    })
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.brandId, brandId),
        realTraffic(),
        ...(window ? [gte(s.conversations.startedAt, window.from)] : []),
        ...(window?.to ? [lt(s.conversations.startedAt, window.to)] : []),
      ),
    );

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

  // What these conversations actually cost, not what a rate card guessed.
  const costTotal = rows.reduce((a, r) => a + (r.costPaise ?? 0), 0);
  const costPer = total > 0 ? costTotal / total : 0;

  const waiting = rows.filter((r) => r.status === "waiting_human").length;
  const live = rows.filter((r) => r.status === "live").length;

  const CHANNEL_NAME: Record<string, string> = {
    phone: "Phone",
    whatsapp: "WhatsApp",
    web_chat: "Web chat",
    email: "Email",
    sms: "SMS",
    survey: "Survey",
  };

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
    costPerContactPaise: Math.round(costPer),
    /** Everything these conversations cost, for the spend line. */
    costTotalPaise: Math.round(costTotal),
    /** Split by whether a person was needed — the case for containment. */
    costContainedPaise: Math.round(
      rows.filter((r) => r.contained === true).reduce((a, r) => a + (r.costPaise ?? 0), 0),
    ),
    costEscalatedPaise: Math.round(
      rows.filter((r) => r.contained === false).reduce((a, r) => a + (r.costPaise ?? 0), 0),
    ),
    waiting,
    live,
    channelMix: [...channelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({
        name: CHANNEL_NAME[name] ?? name,
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
    .where(and(eq(s.conversations.brandId, brandId), realTraffic()));

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

/**
 * Weekly containment for the analytics chart.
 *
 * Returns only the span that has data. Padding a young workspace out to
 * twelve weeks renders nine empty columns, which reads as a broken chart
 * rather than as a short history.
 */
export async function weeklyContainment(brandId: string, weeks = 12) {
  const since = new Date(Date.now() - weeks * 7 * 864e5);
  const rows = await db
    .select({ startedAt: s.conversations.startedAt, contained: s.conversations.contained })
    .from(s.conversations)
    .where(
      and(eq(s.conversations.brandId, brandId), realTraffic(), gte(s.conversations.startedAt, since)),
    );

  const buckets = Array.from({ length: weeks }, () => ({ ai: 0, human: 0 }));
  for (const r of rows) {
    const weeksAgo = Math.floor((Date.now() - r.startedAt.getTime()) / (7 * 864e5));
    const idx = weeks - 1 - Math.min(weeks - 1, weeksAgo);
    if (r.contained === false) buckets[idx].human++;
    else buckets[idx].ai++;
  }

  const firstWithData = buckets.findIndex((b) => b.ai + b.human > 0);
  const span = firstWithData === -1 ? [] : buckets.slice(firstWithData);

  return {
    weeks: span.map((b) => {
      const n = b.ai + b.human;
      return {
        ai: n ? `${Math.round((b.ai / n) * 80)}%` : "0%",
        human: n ? `${Math.round((b.human / n) * 80)}%` : "0%",
        total: n,
        contained: b.ai,
        escalated: b.human,
      };
    }),
    weeksCovered: span.length,
  };
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
    .where(
      and(eq(s.conversations.brandId, brandId), realTraffic(), eq(s.conversations.contained, false)),
    )
    .groupBy(s.conversations.intent);

  /**
   * What one of these contacts costs over what it would cost contained.
   *
   * Measured from this brand's own conversations rather than a flat rate, so a
   * tenant whose escalations are short and cheap is not told a gap is worth
   * more than it is. Falls back to a plain difference of averages when there
   * is not enough of either kind to compare.
   */
  const [averages] = await db
    .select({
      contained: sql<number>`coalesce(avg(${s.conversations.costPaise}) filter (where ${s.conversations.contained}), 0)`,
      escalated: sql<number>`coalesce(avg(${s.conversations.costPaise}) filter (where ${s.conversations.contained} is false), 0)`,
    })
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brandId), realTraffic()));

  // A gap that costs nothing extra is not worth pricing; show it as unpriced
  // rather than as ₹0, which reads as "we measured it and it is free".
  const perContact = Math.max(0, Number(averages.escalated) - Number(averages.contained));
  const monthly = (hits: number) =>
    perContact > 0 ? `${formatRupees(hits * perContact * 4)} / mo` : "not yet priced";

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
    cost: monthly(g.hits),
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
      cost: monthly(e.n),
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
    .where(and(eq(s.conversations.brandId, brandId), realTraffic(), eq(s.turns.speaker, "ai")));

  const [cited] = await db
    .select({ n: sql<number>`count(DISTINCT ${s.turnCitations.turnId})::int` })
    .from(s.turnCitations)
    .innerJoin(s.turns, eq(s.turns.id, s.turnCitations.turnId))
    .innerJoin(s.conversations, eq(s.conversations.id, s.turns.conversationId))
    .where(and(eq(s.conversations.brandId, brandId), realTraffic()));

  const [refused] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversationActions)
    .innerJoin(s.conversations, eq(s.conversations.id, s.conversationActions.conversationId))
    .where(
      and(eq(s.conversations.brandId, brandId), realTraffic(), eq(s.conversationActions.allowed, false)),
    );

  const [reviewed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversations)
    .where(
      and(eq(s.conversations.brandId, brandId), realTraffic(), sql`${s.conversations.reviewScore} IS NOT NULL`),
    );

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

  // Listing everyone with a row of dashes is noise; the rail is for people who
  // have actually taken something off the queue.
  return rows
    .filter((r) => r.handled > 0)
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      role: r.role[0].toUpperCase() + r.role.slice(1),
      handled: String(r.handled),
    }));
}

/* ─── The team, as opposed to the AI ───────────────────────────────────── */

/**
 * How each person is doing, for the Manager's screen.
 *
 * Everything else in this module measures the AI. This measures the people —
 * a different question, asked by a different person, which is why it has its
 * own screen and its own capability rather than another panel on Analytics.
 *
 * Every figure is derived from rows that already exist for other reasons: a
 * handoff someone accepted, a conversation they were the named human on, a
 * review somebody left. Nothing is self-reported and nothing is a counter that
 * has to be kept in step. The one stored number is `rating`, which is a
 * judgement rather than a measurement and is seeded and edited as one.
 *
 * Five grouped queries stitched together in JS, rather than one query with
 * five correlated subqueries. The subquery version was written first and was
 * silently wrong: inside a raw `sql` template drizzle emits a bare `"id"`, and
 * `where h.accepted_by_membership_id = "id"` binds that to `h.id` rather than
 * to the membership — so every column read zero against a database that was
 * entirely correct. Grouping is both faster and impossible to get wrong that
 * way.
 *
 * Scoped to a brand, because a Manager runs a brand: an org-wide table would
 * mix in colleagues they are not accountable for and cannot act on.
 */
export async function teamPerformance(orgId: string, brandId: string) {
  const [people, handoffStats, openStats, book, handled, aiOnlyRows] = await Promise.all([
    db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active"))),

    // What each person took off the queue, and how quickly.
    db
      .select({
        membershipId: s.handoffs.acceptedByMembershipId,
        accepted: sql<number>`count(*)::int`,
        resolved: sql<number>`count(*) filter (where ${s.handoffs.status} = 'resolved')::int`,
        /**
         * Median seconds from raised to picked up.
         *
         * The mean is the wrong statistic: one handoff that sat overnight
         * because it landed at 17:58 would put a good week's median at forty
         * minutes, and nobody would trust the column again.
         */
        pickupSeconds: sql<number | null>`percentile_cont(0.5) within group (
          order by extract(epoch from (${s.handoffs.acceptedAt} - ${s.handoffs.waitingSince}))
        )`,
      })
      .from(s.handoffs)
      .where(and(eq(s.handoffs.brandId, brandId), isNotNull(s.handoffs.acceptedByMembershipId)))
      .groupBy(s.handoffs.acceptedByMembershipId),

    // Still on someone's plate: accepted by them, or ringing at them.
    db
      .select({
        membershipId: sql<string>`coalesce(${s.handoffs.acceptedByMembershipId}, ${s.handoffs.routedToMembershipId})`,
        open: sql<number>`count(*)::int`,
      })
      .from(s.handoffs)
      .where(
        and(
          eq(s.handoffs.brandId, brandId),
          inArray(s.handoffs.status, ["waiting", "accepted"]),
          sql`coalesce(${s.handoffs.acceptedByMembershipId}, ${s.handoffs.routedToMembershipId}) is not null`,
        ),
      )
      .groupBy(sql`coalesce(${s.handoffs.acceptedByMembershipId}, ${s.handoffs.routedToMembershipId})`),

    // Accounts held, and what they are worth — "closing deals", in this product.
    db
      .select({
        membershipId: s.customers.ownerMembershipId,
        customers: sql<number>`count(*)::int`,
        bookPaise: sql<number>`coalesce(sum(${s.customers.ltvPaise}), 0)::bigint`,
      })
      .from(s.customers)
      .where(and(eq(s.customers.brandId, brandId), isNotNull(s.customers.ownerMembershipId)))
      .groupBy(s.customers.ownerMembershipId),

    /**
     * Conversations they were the named human on.
     *
     * Keyed by name rather than id because `conversations.handled_by` is a
     * denormalised label, not a foreign key. Rehearsals are excluded: a test
     * call is not work someone did.
     */
    db
      .select({
        name: s.conversations.handledBy,
        conversations: sql<number>`count(*)::int`,
        reviewScore: sql<number | null>`avg(${s.conversations.reviewScore})`,
        sentimentEnd: sql<number | null>`avg(${s.conversations.sentimentEnd})`,
      })
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.brandId, brandId),
          eq(s.conversations.isTest, false),
          isNotNull(s.conversations.handledBy),
        ),
      )
      .groupBy(s.conversations.handledBy),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.customers)
      .where(and(eq(s.customers.brandId, brandId), isNull(s.customers.ownerMembershipId))),
  ]);

  const handoffsBy = new Map(handoffStats.map((r) => [r.membershipId!, r]));
  const openBy = new Map(openStats.map((r) => [r.membershipId, r.open]));
  const bookBy = new Map(book.map((r) => [r.membershipId!, r]));
  const handledBy = new Map(handled.map((r) => [r.name!, r]));

  // Only people who can be handed a customer. An Analyst has no handling
  // numbers by construction, and a row of dashes against their name reads as a
  // failing grade rather than as "not their job".
  const rows = people
    .filter((m) => can({ role: m.role, brandIds: null }, "calls.handle").allowed)
    .map((m) => {
      const h = handoffsBy.get(m.id);
      const b = bookBy.get(m.id);
      const c = handledBy.get(m.name);
      const accepted = h?.accepted ?? 0;
      const resolved = h?.resolved ?? 0;
      const pickup = h?.pickupSeconds == null ? null : Math.round(Number(h.pickupSeconds));
      const bookPaise = Number(b?.bookPaise ?? 0);

      return {
        membershipId: m.id,
        name: m.name,
        role: m.role[0].toUpperCase() + m.role.slice(1),
        rating: m.rating,
        availability: m.availability,
        specialities: m.specialities,
        accepted,
        resolved,
        open: openBy.get(m.id) ?? 0,
        conversations: c?.conversations ?? 0,
        customers: b?.customers ?? 0,
        book: formatRupees(bookPaise),
        bookPaise,
        pickup: pickup === null ? "—" : pickup < 90 ? `${pickup}s` : `${Math.round(pickup / 60)}m`,
        pickupSeconds: pickup,
        reviewScore: c?.reviewScore == null ? null : Number(c.reviewScore),
        sentimentEnd: c?.sentimentEnd == null ? null : Number(c.sentimentEnd),
        /**
         * The share of what they accepted that they actually finished.
         *
         * Null rather than 0% when they have accepted nothing — "resolved none
         * of none" is not a hundred per cent and it is not zero, it is a
         * question the data cannot answer yet.
         */
        closeRate: accepted > 0 ? Math.round((resolved / accepted) * 100) : null,
      };
    });

  // Busiest first: the point of the table is who is carrying what.
  rows.sort((a, b2) => b2.accepted - a.accepted || b2.customers - a.customers);

  return {
    people: rows,
    totals: {
      people: rows.length,
      available: rows.filter((p) => p.availability === "available").length,
      open: rows.reduce((a, p) => a + p.open, 0),
      accepted: rows.reduce((a, p) => a + p.accepted, 0),
      resolved: rows.reduce((a, p) => a + p.resolved, 0),
      /** Accounts on this brand that no person holds — the AI is running them. */
      aiOnly: aiOnlyRows[0]?.n ?? 0,
    },
  };
}
