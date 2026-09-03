import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { latestScores } from "./scoring";

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
const N_500 = "var(--color-neutral-500)";
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
export async function getLiveCall(brandId: string) {
  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.brandId, brandId),
        inArray(s.conversations.status, ["live", "waiting_human"]),
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

  return {
    conversation,
    customer,
    priority: score ? Math.round(score.blended) : null,
    elapsed: clock(
      conversation.durationSeconds ??
        Math.floor((Date.now() - conversation.startedAt.getTime()) / 1000),
    ),
    turns: turnRows.map((t) => ({
      id: t.id,
      label: `${t.atSeconds !== null ? clock(t.atSeconds) : ""} ${t.speaker === "customer" ? "Cust" : t.speaker === "ai" ? "AI" : (t.authorName ?? "Human")}`.trim(),
      isAi: t.speaker === "ai",
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
      at: clock(a.atSeconds),
      label: a.label,
      allowed: a.allowed,
    })),
    handoff: handoff ?? null,
    facts: [
      { label: "Lifetime value", value: customer ? money(customer.ltvPence) : "—", hot: false },
      {
        label: "Churn risk",
        value: signalBy.has("churn_risk")
          ? `${Math.round(signalBy.get("churn_risk")!.value)} · ${signalBy.get("churn_risk")!.value >= 60 ? "high" : "moderate"}`
          : "—",
        hot: (signalBy.get("churn_risk")?.value ?? 0) >= 60,
      },
      { label: "Contacts this month", value: "—", hot: false },
      { label: "Last agent", value: customer?.owner ?? "AI only", hot: false },
      { label: "Tier", value: customer?.tier ?? "—", hot: false },
    ],
    sentiment: conversation.sentimentEnd,
  };
}

/* ─── The handoff queue ────────────────────────────────────────────────── */

export async function listHandoffs(brandId: string) {
  const rows = await db
    .select({ handoff: s.handoffs, conversation: s.conversations, customer: s.customers })
    .from(s.handoffs)
    .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.handoffs.brandId, brandId), eq(s.handoffs.status, "waiting")))
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

export async function listConversations(brandId: string, limit = 20) {
  const rows = await db
    .select({ conversation: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.brandId, brandId))
    .orderBy(desc(s.conversations.startedAt))
    .limit(limit);

  return rows.map(({ conversation: c, customer }) => {
    const bad = isBad(c.outcome);
    const negative = (c.sentimentEnd ?? 0) < 0;
    return {
      id: c.id,
      name: customer?.name ?? "Unidentified",
      when: c.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      intent: c.intent ?? "Conversation",
      outcome: outcomeLabel(c.outcome, c.status),
      channel: channelLabel(c.channel),
      duration: c.status === "live" ? "live" : clock(c.durationSeconds),
      sentiment: c.sentimentEnd === null ? "—" : `${c.sentimentEnd > 0 ? "+" : "−"}${Math.abs(c.sentimentEnd).toFixed(2)}`,
      bad,
      edge: bad ? ACCENT : N_400,
      tagBg: bad ? ACCENT_200 : N_200,
      tagFg: bad ? ACCENT_800 : N_800,
      sentColor: negative ? ACCENT_700 : N_800,
    };
  });
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

  return {
    conversation: row.conversation,
    customer: row.customer,
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
    .select({ status: s.conversations.status, outcome: s.conversations.outcome, contained: s.conversations.contained })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brandId));

  const total = rows.length;
  const contained = rows.filter((r) => r.contained === true).length;
  const unresolved = rows.filter((r) => isBad(r.outcome)).length;

  return {
    total,
    unresolved,
    containment: total > 0 ? (contained / total) * 100 : 0,
    waiting: rows.filter((r) => r.status === "waiting_human").length,
    live: rows.filter((r) => r.status === "live").length,
  };
}
