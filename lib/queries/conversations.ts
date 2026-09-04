import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { latestScores } from "./scoring";
import { stillLive } from "./live-data";

/**
 * Read models for the three conversation screens: the live console, the
 * handoff queue, and the archive. They share a shape because they are three
 * views of the same rows at different moments in their life.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
const N_400 = "var(--color-neutral-400)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";

export const money = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** "6m 12s" — how the queue counts a wait. */
export function waited(since: Date): string {
  const secs = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  const mins = Math.floor(secs / 60);
  if (mins < 1) return `${secs}s`;
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export const clock = (seconds: number | null) =>
  seconds === null
    ? "—"
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const CHANNEL_LABEL: Record<string, string> = {
  phone: "Phone",
  whatsapp: "WhatsApp",
  web_chat: "Web chat",
  email: "Email",
  sms: "SMS",
  survey: "Survey",
};

const OUTCOME_LABEL: Record<string, string> = {
  ai_resolved: "AI resolved",
  human_resolved: "Human resolved",
  escalated: "Escalated",
  no_document: "No document",
  no_follow_up: "No follow-up",
  detractor: "Detractor",
};

export const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c;
export const outcomeLabel = (o: string | null, status: string) =>
  o ? (OUTCOME_LABEL[o] ?? o) : status === "live" ? "Live" : "Waiting";

/** Whether an outcome should read as a problem. */
const isBad = (o: string | null) =>
  o === "escalated" || o === "no_document" || o === "detractor" || o === "no_follow_up";

/* ─── The live console ─────────────────────────────────────────────────── */

/** Everything the live call console needs, for the most recent open call. */
/**
 * The live call console's whole read model.
 *
 * Takes an optional conversation id so the console can be pointed at a
 * specific call — the command centre's "Listen in" links carry one. With no
 * id it picks the newest conversation that still needs someone, which is the
 * right default for a screen you open when a bell rings.
 */
export async function getLiveCall(brandId: string, conversationId?: string) {
  const [conversation] = conversationId
    ? await db
        .select()
        .from(s.conversations)
        .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.id, conversationId)))
        .limit(1)
    : await db
        .select()
        .from(s.conversations)
        .where(
          and(
            eq(s.conversations.brandId, brandId),
            inArray(s.conversations.status, ["live", "waiting_human"]),
            stillLive(),
          ),
        )
        .orderBy(desc(s.conversations.startedAt))
        .limit(1);

  if (!conversation) return null;

  const [customer] = conversation.customerId
    ? await db.select().from(s.customers).where(eq(s.customers.id, conversation.customerId)).limit(1)
    : [null];

  const turnRows = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversation.id))
    .orderBy(asc(s.turns.ordinal));

  const citations = turnRows.length
    ? await db
        .select({ citation: s.turnCitations, document: s.documents })
        .from(s.turnCitations)
        .leftJoin(s.documents, eq(s.documents.id, s.turnCitations.documentId))
        .where(inArray(s.turnCitations.turnId, turnRows.map((t) => t.id)))
    : [];

  const citationsByTurn = new Map<string, typeof citations>();
  for (const c of citations) {
    const list = citationsByTurn.get(c.citation.turnId) ?? [];
    list.push(c);
    citationsByTurn.set(c.citation.turnId, list);
  }

  const actions = await db
    .select()
    .from(s.conversationActions)
    .where(eq(s.conversationActions.conversationId, conversation.id))
    .orderBy(asc(s.conversationActions.atSeconds));

  const scores = customer ? await latestScores([customer.id]) : new Map();
  const score = customer ? scores.get(customer.id) : null;

  const [handoff] = await db
    .select()
    .from(s.handoffs)
    .where(eq(s.handoffs.conversationId, conversation.id))
    .limit(1);

  const signals = customer
    ? await db.select().from(s.customerSignals).where(eq(s.customerSignals.customerId, customer.id))
    : [];
  const signalBy = new Map(signals.map((x) => [x.axisKey, x]));

  // Open commercial records, mirrored from the tenant's own systems. These are
  // what the agent is actually reasoning about, so they belong beside the
  // transcript rather than three clicks away on the profile.
  const records = customer
    ? await db
        .select()
        .from(s.customerRecords)
        .where(eq(s.customerRecords.customerId, customer.id))
        .orderBy(desc(s.customerRecords.occurredAt))
        .limit(4)
    : [];

  // How often this customer has been in touch this month — the number that
  // decides whether a complaint is an incident or a pattern.
  const [monthCount] = customer
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.conversations)
        .where(
          and(
            eq(s.conversations.customerId, customer.id),
            sql`${s.conversations.startedAt} > now() - interval '30 days'`,
          ),
        )
    : [{ n: 0 }];

  // Every other conversation that still needs someone, for the call switcher.
  const otherLive = await db
    .select({
      id: s.conversations.id,
      intent: s.conversations.intent,
      status: s.conversations.status,
      channel: s.conversations.channel,
      startedAt: s.conversations.startedAt,
      customerName: s.customers.name,
    })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(
      and(
        eq(s.conversations.brandId, brandId),
        inArray(s.conversations.status, ["live", "waiting_human"]),
        stillLive(),
      ),
    )
    .orderBy(asc(s.conversations.startedAt))
    .limit(10);

  // The documents this call has actually leaned on, strongest first. Derived
  // from the citations rather than from a fresh retrieval, so the panel shows
  // what was used, not what would be used if the question were asked again.
  const inPlay = new Map<string, { title: string; confidence: number; uses: number }>();
  for (const c of citations) {
    if (!c.document) continue;
    const existing = inPlay.get(c.document.id);
    const confidence = c.citation.confidence ?? 0;
    if (existing) {
      existing.uses++;
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      inPlay.set(c.document.id, { title: c.document.title, confidence, uses: 1 });
    }
  }

  // An answer the AI gave with nothing behind it is the failure the design
  // wants visible, so it is counted rather than hidden.
  const ungrounded = turnRows.filter(
    (t) => t.speaker === "ai" && (citationsByTurn.get(t.id) ?? []).every((c) => !c.document),
  ).length;

  const gaps = await db
    .select()
    .from(s.knowledgeGaps)
    .where(eq(s.knowledgeGaps.brandId, brandId))
    .orderBy(desc(s.knowledgeGaps.hits))
    .limit(1);

  // The sentiment curve, one point per turn that carries a reading.
  const sentimentPoints = turnRows
    .filter((t) => t.sentiment !== null)
    .map((t) => ({ at: t.atSeconds, value: t.sentiment as number }));

  return {
    conversation,
    customer,
    priority: score ? Math.round(score.blended) : null,
    elapsed: clock(
      conversation.durationSeconds ??
        Math.floor((Date.now() - conversation.startedAt.getTime()) / 1000),
    ),
    /** True while the AI is still the one answering. */
    aiHolding: !conversation.handledBy,
    heldBy: conversation.handledBy,
    ended: conversation.status === "resolved" || conversation.status === "abandoned",
    turns: turnRows.map((t) => ({
      id: t.id,
      label: `${t.atSeconds !== null ? clock(t.atSeconds) : ""} ${t.speaker === "customer" ? "Cust" : t.speaker === "ai" ? "AI" : t.speaker === "system" ? "—" : (t.authorName ?? "Human")}`.trim(),
      isAi: t.speaker === "ai",
      isSystem: t.speaker === "system",
      body: t.body,
      citations: (citationsByTurn.get(t.id) ?? []).map((c) => ({
        cite: c.document
          ? `Cited · ${c.document.title}`
          : c.citation.confidence === null
            ? null
            : "No document cited",
        check: c.citation.checkLabel,
      })),
    })),
    actions: actions.map((a) => ({
      at: a.atSeconds === null ? "—" : clock(a.atSeconds),
      label: a.label,
      allowed: a.allowed,
    })),
    handoff: handoff ?? null,
    records: records.map((r) => ({
      id: r.id,
      ref: r.ref ?? r.kind,
      line: r.label,
      status: [r.status, r.amountPence !== null ? money(r.amountPence) : null].filter(Boolean).join(" · "),
      // A rescheduled or disputed record is the reason for most calls.
      urgent: /reschedul|disput|overdue|failed/i.test(r.status ?? ""),
    })),
    documentsInPlay: [...inPlay.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .map((d) => ({
        title: d.title,
        confidence: `${Math.round(d.confidence * 100)}%`,
        note: d.uses === 1 ? "cited once" : `cited ${d.uses} times`,
        strong: d.confidence >= 0.85,
      })),
    ungroundedTurns: ungrounded,
    topGap: gaps[0] ? { id: gaps[0].id, intent: gaps[0].intent, hits: gaps[0].hits } : null,
    sentimentPoints,
    otherLive: otherLive.map((c) => ({
      id: c.id,
      name: c.customerName ?? "Unknown caller",
      intent: c.intent ?? "Not yet classified",
      channel: c.channel,
      waiting: c.status === "waiting_human",
      elapsed: clock(Math.floor((Date.now() - c.startedAt.getTime()) / 1000)),
    })),
    facts: [
      { label: "Lifetime value", value: customer ? money(customer.ltvPence) : "—", hot: false },
      {
        label: "Churn risk",
        value: signalBy.has("churn_risk")
          ? `${Math.round(signalBy.get("churn_risk")!.value)} · ${signalBy.get("churn_risk")!.value >= 60 ? "high" : "moderate"}`
          : "—",
        hot: (signalBy.get("churn_risk")?.value ?? 0) >= 60,
      },
      { label: "Contacts, 30 days", value: String(monthCount?.n ?? 0), hot: (monthCount?.n ?? 0) >= 8 },
      { label: "Last agent", value: customer?.owner ?? "AI only", hot: false },
      { label: "Tier", value: customer?.tier ?? "—", hot: false },
    ],
    sentiment: conversation.sentimentEnd,
  };
}

/* ─── The handoff queue ────────────────────────────────────────────────── */

export async function listHandoffs(
  brandId: string,
  status: "waiting" | "accepted" | "resolved" | "all" = "waiting",
) {
  const rows = await db
    .select({
      handoff: s.handoffs,
      conversation: s.conversations,
      customer: s.customers,
      acceptedBy: s.memberships.name,
    })
    .from(s.handoffs)
    .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .leftJoin(s.memberships, eq(s.memberships.id, s.handoffs.acceptedByMembershipId))
    .where(
      and(
        eq(s.handoffs.brandId, brandId),
        ...(status === "all"
          ? []
          : [eq(s.handoffs.status, status as (typeof s.handoffStatusEnum.enumValues)[number])]),
      ),
    )
    .orderBy(asc(s.handoffs.waitingSince));

  // Wait time alone buries the expensive cases behind cheap ones that have sat
  // longer. The queue is ordered the way the priority queue is: by what it
  // costs to ignore, with the wait breaking ties.

  const scores = await latestScores(
    rows.map((r) => r.customer?.id).filter(Boolean) as string[],
  );

  const mapped = rows.map((r) => {
    const priority = r.customer ? Math.round(scores.get(r.customer.id)?.blended ?? 0) : 0;
    // Urgency is the wait plus what is at stake, not the wait alone.
    const urgent = priority >= 70 || r.conversation.status === "live";
    const isLive = r.conversation.status === "live";

    return {
      id: r.handoff.id,
      conversationId: r.conversation.id,
      customerId: r.customer?.id ?? null,
      name: r.customer?.name ?? "Unidentified",
      wait: waited(r.handoff.waitingSince),
      reason: r.handoff.reason,
      brief: r.handoff.brief as Record<string, never>,
      channel: `${channelLabel(r.conversation.channel)}${isLive ? " · live" : ""}`,
      priority,
      value: r.customer ? money(r.customer.ltvPence) : "—",
      urgent,
      status: r.handoff.status,
      acceptedBy: r.acceptedBy,
      resolution: r.handoff.resolution,
      edge: urgent ? ACCENT : N_400,
      waitColor: urgent ? ACCENT_700 : N_700,
      tagBg: isLive ? ACCENT_200 : N_200,
      tagFg: isLive ? ACCENT_800 : N_800,
      waitingSince: r.handoff.waitingSince,
    };
  });

  return mapped.sort((a, b) => {
    // A call still connected outranks anything queued asynchronously.
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.waitingSince.getTime() - b.waitingSince.getTime();
  });
}

/** How many handoffs sit in each state, for the queue's tabs. */
export async function handoffCounts(brandId: string) {
  const rows = await db
    .select({ status: s.handoffs.status, n: sql<number>`count(*)::int` })
    .from(s.handoffs)
    .where(eq(s.handoffs.brandId, brandId))
    .groupBy(s.handoffs.status);
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return {
    waiting: by.get("waiting") ?? 0,
    accepted: by.get("accepted") ?? 0,
    resolved: by.get("resolved") ?? 0,
    all: rows.reduce((a, r) => a + r.n, 0),
  };
}

/** The transcript behind one handoff, for the brief pane. */
export async function getHandoffTranscript(conversationId: string) {
  const rows = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  return rows.map((t) => ({
    id: t.id,
    label: `${t.atSeconds !== null ? clock(t.atSeconds) : ""} ${t.speaker === "customer" ? "Cust" : t.speaker === "ai" ? "AI" : (t.authorName ?? "Human")}`.trim(),
    ai: t.speaker === "ai",
    text: t.body,
  }));
}

/* ─── The archive ──────────────────────────────────────────────────────── */

export type ArchiveFilters = {
  q?: string;
  channel?: string[];
  outcome?: string[];
  status?: string;
  /** "7", "30", "90" — days back. */
  since?: string;
  /** Only conversations a person reviewed, or only those nobody has. */
  reviewed?: "yes" | "no";
  /** "only" for rehearsals alone, "exclude" to hide them. Default shows both. */
  test?: "only" | "exclude";
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * The conversation archive.
 *
 * Filtering happens in SQL rather than after the fetch, because the archive is
 * the one screen that grows without bound — a workspace six months in has tens
 * of thousands of rows and "load them all, then filter" stops working long
 * before anyone notices it was doing that.
 */
export async function listConversations(brandId: string, filters: ArchiveFilters = {}) {
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);

  const where = [eq(s.conversations.brandId, brandId)];

  if (filters.channel?.length) {
    where.push(inArray(s.conversations.channel, filters.channel as (typeof s.channelEnum.enumValues)[number][]));
  }
  if (filters.outcome?.length) {
    where.push(inArray(s.conversations.outcome, filters.outcome as (typeof s.outcomeEnum.enumValues)[number][]));
  }
  if (filters.status) {
    where.push(eq(s.conversations.status, filters.status as (typeof s.conversationStatusEnum.enumValues)[number]));
  }
  if (filters.since) {
    const days = Number(filters.since);
    if (Number.isFinite(days) && days > 0) {
      where.push(gte(s.conversations.startedAt, new Date(Date.now() - days * 864e5)));
    }
  }
  if (filters.test === "only") where.push(eq(s.conversations.isTest, true));
  if (filters.test === "exclude") where.push(eq(s.conversations.isTest, false));
  if (filters.reviewed === "yes") where.push(isNotNull(s.conversations.reviewScore));
  if (filters.reviewed === "no") where.push(isNull(s.conversations.reviewScore));
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        ilike(s.conversations.intent, pattern),
        ilike(s.customers.name, pattern),
        sql`exists (select 1 from ${s.turns} t where t.conversation_id = ${s.conversations.id} and t.body ilike ${pattern})`,
      )!,
    );
  }

  const condition = and(...where);

  const ORDER = {
    started: s.conversations.startedAt,
    duration: s.conversations.durationSeconds,
    sentiment: s.conversations.sentimentEnd,
    review: s.conversations.reviewScore,
  } as const;
  const [sortField, sortDir] = (filters.sort ?? "started:desc").split(":");
  const column = ORDER[sortField as keyof typeof ORDER] ?? s.conversations.startedAt;

  const [rows, [count]] = await Promise.all([
    db
      .select({ conversation: s.conversations, customer: s.customers })
      .from(s.conversations)
      .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
      .where(condition)
      .orderBy(sortDir === "asc" ? asc(column) : desc(column))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.conversations)
      .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
      .where(condition),
  ]);

  return {
    total: count.n,
    page,
    pageSize,
    rows: rows.map(({ conversation: c, customer }) => {
      const bad = isBad(c.outcome);
      const negative = (c.sentimentEnd ?? 0) < 0;
      return {
        id: c.id,
        name: customer?.name ?? "Unidentified",
        customerId: customer?.id ?? null,
        summary: c.summary,
        isTest: c.isTest,
        when: c.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        intent: c.intent ?? "Conversation",
        outcome: outcomeLabel(c.outcome, c.status),
        channel: channelLabel(c.channel),
        duration: c.status === "live" ? "live" : clock(c.durationSeconds),
        sentiment:
          c.sentimentEnd === null
            ? "—"
            : `${c.sentimentEnd > 0 ? "+" : "−"}${Math.abs(c.sentimentEnd).toFixed(2)}`,
        review: c.reviewScore,
        bad,
        edge: bad ? ACCENT : N_400,
        tagBg: bad ? ACCENT_200 : N_200,
        tagFg: bad ? ACCENT_800 : N_800,
        sentColor: negative ? ACCENT_700 : N_800,
      };
    }),
  };
}

/** The facet counts beside each filter, so a filter says how much it will hide. */
export async function archiveFacets(brandId: string) {
  const [channels, outcomes, reviewed] = await Promise.all([
    db
      .select({ key: s.conversations.channel, n: sql<number>`count(*)::int` })
      .from(s.conversations)
      .where(eq(s.conversations.brandId, brandId))
      .groupBy(s.conversations.channel),
    db
      .select({ key: s.conversations.outcome, n: sql<number>`count(*)::int` })
      .from(s.conversations)
      .where(eq(s.conversations.brandId, brandId))
      .groupBy(s.conversations.outcome),
    db
      .select({
        yes: sql<number>`count(*) filter (where ${s.conversations.reviewScore} is not null)::int`,
        no: sql<number>`count(*) filter (where ${s.conversations.reviewScore} is null)::int`,
        tests: sql<number>`count(*) filter (where ${s.conversations.isTest})::int`,
      })
      .from(s.conversations)
      .where(eq(s.conversations.brandId, brandId)),
  ]);

  return {
    channels: channels.map((c) => ({ key: c.key, label: channelLabel(c.key), count: c.n })),
    outcomes: outcomes
      .filter((o) => o.key !== null)
      .map((o) => ({ key: o.key!, label: outcomeLabel(o.key, "resolved"), count: o.n })),
    reviewed: reviewed[0],
    tests: reviewed[0].tests,
  };
}

/** One conversation in full, for the archive's detail pane. */
export async function getConversation(brandId: string, conversationId: string) {
  const [row] = await db
    .select({ conversation: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.id, conversationId)))
    .limit(1);
  if (!row) return null;

  const turnRows = await db
    .select()
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));

  const citations = turnRows.length
    ? await db
        .select({ citation: s.turnCitations, document: s.documents })
        .from(s.turnCitations)
        .leftJoin(s.documents, eq(s.documents.id, s.turnCitations.documentId))
        .where(inArray(s.turnCitations.turnId, turnRows.map((t) => t.id)))
    : [];

  const byTurn = new Map<string, { cite: string | null; check: string | null }[]>();
  for (const c of citations) {
    const list = byTurn.get(c.citation.turnId) ?? [];
    list.push({
      cite: c.document ? `Cited · ${c.document.title}` : null,
      check: c.citation.checkLabel,
    });
    byTurn.set(c.citation.turnId, list);
  }

  const cost = (row.conversation.costBreakdown ?? {}) as {
    lines?: { label: string; units: number; unit: string; pence: number }[];
  };

  return {
    conversation: row.conversation,
    customer: row.customer,
    cost: {
      pence: row.conversation.costPence,
      lines: cost.lines ?? [],
    },
    turns: turnRows.map((t) => ({
      id: t.id,
      speaker: t.speaker,
      label: `${t.atSeconds !== null ? clock(t.atSeconds) : t.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ${t.speaker === "customer" ? "Cust" : t.speaker === "ai" ? "AI" : "Human"}`,
      authorName: t.authorName,
      body: t.body,
      provenance: byTurn.get(t.id) ?? [],
    })),
  };
}

/** The counts the archive's filter bar prints. */
export async function conversationStats(brandId: string) {
  const rows = await db
    .select({
      status: s.conversations.status,
      outcome: s.conversations.outcome,
      contained: s.conversations.contained,
      isTest: s.conversations.isTest,
      // The badge in the top bar has to agree with the screen it points at,
      // so it applies the same staleness rule the live console does.
      active: stillLive(),
    })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brandId));

  // Containment is a metric, so rehearsals are excluded. Live and waiting are
  // operational — a test call ringing right now genuinely is ringing right
  // now, and hiding it from the badge you are about to click would be a lie.
  const real = rows.filter((r) => !r.isTest);
  const total = real.length;
  const contained = real.filter((r) => r.contained === true).length;

  return {
    total,
    unresolved: real.filter((r) => isBad(r.outcome)).length,
    containment: total > 0 ? (contained / total) * 100 : 0,
    waiting: rows.filter((r) => r.status === "waiting_human").length,
    live: rows.filter((r) => r.status === "live" && r.active).length,
  };
}
