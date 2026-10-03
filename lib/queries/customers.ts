import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { handlesOf, matchesFor, mergesInto } from "@/lib/crm/identity";
import { freshProfile } from "@/lib/crm/profile";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";
import { config } from "@/lib/config";
import { latestScores } from "./scoring";
import { customerIsTheirs } from "./scoping";

/**
 * Read models for the customer screens.
 *
 * These return presentation-ready rows — bar widths and accent colours — so a
 * screen stays a layout and the thresholds live in one place. The colour rules
 * are the ones the designs specified.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
const N_500 = "var(--color-neutral-500)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";

const scoreColor = (n: number) => (n >= config.accentPriorityThreshold ? ACCENT : N_700);
const pct = (n: number) => `${Math.round(n)}%`;

const money = (paise: number) => formatRupees(paise);

/** How long ago, in the console's phrasing. */
function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type ListedCustomers = Awaited<ReturnType<typeof listCustomers>>;

export type CustomerFilters = {
  q?: string;
  /** Minimum blended priority. */
  minScore?: number;
  /** Minimum value on a named axis, e.g. { churn_risk: 60 }. */
  axisMinimums?: Record<string, number>;
  segment?: string[];
  tier?: string[];
  /** Behaviour flags: "on_call", "churn", "expansion", "detractor", "payment". */
  flag?: string[];
  /** Days since last contact: "7", "30", "90". */
  lastContact?: string;
  owner?: string;
  /**
   * Narrow to one person's accounts.
   *
   * "Theirs" is deliberately wider than "assigned to them": a customer they
   * are mid-conversation with is theirs whether or not anyone has got round to
   * setting an owner. An Agent who has just taken a transferred call would
   * otherwise not find that customer on their own screen, which is the moment
   * they most need to.
   */
  ownedBy?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Which behaviour flag a customer carries.
 *
 * One flag, not several, because the table has one column for it and the
 * question it answers — "what is the single most notable thing about this
 * account right now" — has one answer. The order below is that priority.
 */
function behaviourFlag(
  onCall: boolean,
  signal: (key: string) => number | undefined,
): { key: string; label: string } {
  if (onCall) return { key: "on_call", label: "On call" };
  if ((signal("churn_risk") ?? 0) >= 60) return { key: "churn", label: "Churn risk" };
  if ((signal("expansion_potential") ?? 0) >= 70) return { key: "expansion", label: "Expansion" };
  if ((signal("advocacy_nps") ?? 100) <= 30) return { key: "detractor", label: "Detractor" };
  if ((signal("payment_reliability") ?? 100) <= 40) return { key: "payment", label: "Payment" };
  return { key: "healthy", label: "Healthy" };
}

const HOT_FLAGS = new Set(["on_call", "churn", "detractor", "payment"]);

/**
 * The customer table.
 *
 * Filtering on score and axis values happens in memory rather than in SQL,
 * because both live in tables keyed by customer and a filtered join across
 * eleven axes reads worse than it performs at this size. The name and segment
 * filters, which do narrow the set meaningfully, are pushed into the query.
 */
export async function listCustomers(brandId: string, filters: CustomerFilters = {}) {
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);

  const where = [eq(s.customers.brandId, brandId)];
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        ilike(s.customers.name, pattern),
        ilike(s.customers.externalRef, pattern),
        ilike(s.customers.email, pattern),
        ilike(s.customers.location, pattern),
        ilike(s.customers.phone, pattern),
      )!,
    );
  }
  if (filters.segment?.length) where.push(inArray(s.customers.segment, filters.segment));
  if (filters.tier?.length) where.push(inArray(s.customers.tier, filters.tier));
  if (filters.owner) where.push(eq(s.customers.owner, filters.owner));
  if (filters.ownedBy) where.push(customerIsTheirs(filters.ownedBy));

  const rows = await db.select().from(s.customers).where(and(...where));
  if (rows.length === 0) {
    return { rows: [], total: 0, page, pageSize, facets: { segments: [], tiers: [], owners: [] } };
  }

  const ids = rows.map((r) => r.id);
  const [scores, signals, live, lastContact, openLeads] = await Promise.all([
    latestScores(ids),
    db.select().from(s.customerSignals).where(inArray(s.customerSignals.customerId, ids)),
    db
      .select({ customerId: s.conversations.customerId })
      .from(s.conversations)
      // "On call" is operational, so a rehearsal in progress still counts.
      .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.status, "live"))),
    // The last time anyone actually spoke to them. Previously this column
    // showed how long they had been a customer, which is a different number
    // and made every quiet account look freshly contacted.
    db
      .select({
        customerId: s.conversations.customerId,
        at: sql<Date>`max(${s.conversations.startedAt})`,
      })
      .from(s.conversations)
      // Test calls count: "when did we last speak to them" is operational, not a metric.
      .where(inArray(s.conversations.customerId, ids))
      .groupBy(s.conversations.customerId),
    db
      .select({ customerId: s.leads.customerId, n: sql<number>`count(*)::int` })
      .from(s.leads)
      .where(and(inArray(s.leads.customerId, ids), inArray(s.leads.stage, ["new", "contacted", "qualified", "proposal"])))
      .groupBy(s.leads.customerId),
  ]);
  const leadsBy = new Map(openLeads.map((l) => [l.customerId, l.n]));

  const byCustomer = new Map<string, Map<string, (typeof signals)[number]>>();
  for (const sig of signals) {
    const map = byCustomer.get(sig.customerId) ?? new Map();
    map.set(sig.axisKey, sig);
    byCustomer.set(sig.customerId, map);
  }

  const onCall = new Set(live.map((l) => l.customerId).filter(Boolean) as string[]);
  const contactedAt = new Map(
    lastContact
      .filter((l) => l.customerId)
      .map((l) => [l.customerId!, l.at instanceof Date ? l.at : new Date(l.at)]),
  );

  let enriched = rows.map((c) => {
    const sig = byCustomer.get(c.id);
    const value = (key: string) => sig?.get(key)?.value;
    const churn = value("churn_risk") ?? 0;
    const sentiment = sig?.get("sentiment");
    const priority = scores.get(c.id)?.blended ?? 0;
    const sentimentDisplay = sentiment?.display ?? (sentiment ? sentiment.value.toFixed(0) : "—");
    const negative = sentimentDisplay.startsWith("−") || sentimentDisplay.startsWith("-");
    const flag = behaviourFlag(onCall.has(c.id), value);
    const hot = HOT_FLAGS.has(flag.key);
    const last = contactedAt.get(c.id) ?? null;

    return {
      id: c.id,
      name: c.name,
      segment: c.segment,
      tier: c.tier,
      /**
       * "AI only", not "Unassigned".
       *
       * An account with no owner is not an oversight anyone needs to correct —
       * it is the AI handling that customer end to end, which is the product
       * working. Calling it unassigned reads as a gap in a list a Manager is
       * scanning for gaps, and sends someone to fix a thing that is fine.
       */
      owner: c.owner ?? "AI only",
      meta: [c.segment, c.tier, c.location].filter(Boolean).join(" · "),
      phone: c.phone,
      openLeads: leadsBy.get(c.id) ?? 0,
      priority: Math.round(priority),
      pColor: scoreColor(priority),
      ltv: money(c.ltvPaise),
      ltvPaise: c.ltvPaise,
      churn: `${Math.round(churn)} · ${churn >= 60 ? "high" : churn >= 35 ? "medium" : "low"}`,
      churnValue: churn,
      churnBar: pct(churn),
      churnColor: churn >= 60 ? ACCENT : N_500,
      sentiment: sentimentDisplay,
      sentColor: negative ? ACCENT_700 : N_800,
      last: onCall.has(c.id) ? "on call now" : ago(last),
      lastContactAt: last,
      flag: flag.label,
      flagKey: flag.key,
      flagBg: hot ? ACCENT_200 : N_200,
      flagFg: hot ? ACCENT_800 : N_800,
      signalValue: value,
    };
  });

  // Facets are computed before the score and flag filters narrow the set, so a
  // filter chip keeps showing the option you would need to click to widen.
  const facets = {
    segments: countBy(enriched.map((c) => c.segment)),
    tiers: countBy(enriched.map((c) => c.tier)),
    owners: countBy(enriched.map((c) => c.owner)),
  };

  if (filters.minScore) enriched = enriched.filter((c) => c.priority >= filters.minScore!);
  if (filters.flag?.length) enriched = enriched.filter((c) => filters.flag!.includes(c.flagKey));
  for (const [axis, minimum] of Object.entries(filters.axisMinimums ?? {})) {
    enriched = enriched.filter((c) => (c.signalValue(axis) ?? 0) >= minimum);
  }
  if (filters.lastContact) {
    const days = Number(filters.lastContact);
    if (Number.isFinite(days)) {
      const cutoff = Date.now() - days * 864e5;
      enriched = enriched.filter((c) => (c.lastContactAt?.getTime() ?? 0) >= cutoff);
    }
  }

  const [sortField, sortDir] = (filters.sort ?? "score:desc").split(":");
  const key = (c: (typeof enriched)[number]) => {
    switch (sortField) {
      case "name": return c.name.toLowerCase();
      case "value": return c.ltvPaise;
      case "churn": return c.churnValue;
      case "last": return c.lastContactAt?.getTime() ?? 0;
      default: return c.priority;
    }
  };
  enriched.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const cmp = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return {
    total: enriched.length,
    page,
    pageSize,
    facets,
    rows: enriched.slice((page - 1) * pageSize, page * pageSize),
  };
}

/** `[{ value, count }]` for a facet column, commonest first, nulls dropped. */
function countBy(values: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

/**
 * One customer's full record, for Customer 360.
 *
 * Pulls the four things the profile shows that live outside `customers`: the
 * scoring arithmetic, the conversation history, the records mirrored from the
 * tenant's other systems, and what people have written about them. Consent is
 * fetched with the rest rather than lazily, because a screen that renders the
 * customer before it knows what they agreed to can show a marketing prompt to
 * someone who opted out.
 */
export async function getCustomer(
  brandId: string,
  customerId: string,
  { ownedBy }: { ownedBy?: string } = {},
) {
  const [customer] = await db
    .select()
    .from(s.customers)
    .where(
      and(
        eq(s.customers.brandId, brandId),
        eq(s.customers.id, customerId),
        // Not found rather than forbidden: an Agent has no business learning
        // that an account exists by being told they may not see it.
        ...(ownedBy ? [customerIsTheirs(ownedBy)] : []),
      ),
    )
    .limit(1);
  if (!customer) return null;
  // Brought up to date first, so the score and signals below are the fresh ones.
  const profile = await freshProfile(customerId, 10 * 60_000).catch(() => null);

  const [scoreRows, signals, conversations, records, consents, notes] = await Promise.all([
    db
      .select()
      .from(s.customerScores)
      .where(eq(s.customerScores.customerId, customerId))
      .orderBy(desc(s.customerScores.computedAt))
      .limit(12),
    db
      .select({ signal: s.customerSignals, axis: s.scoringAxes })
      .from(s.customerSignals)
      .innerJoin(s.scoringAxes, eq(s.scoringAxes.key, s.customerSignals.axisKey))
      .where(eq(s.customerSignals.customerId, customerId)),
    db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.customerId, customerId))
      .orderBy(desc(s.conversations.startedAt))
      .limit(20),
    db
      .select()
      .from(s.customerRecords)
      .where(eq(s.customerRecords.customerId, customerId))
      .orderBy(desc(s.customerRecords.occurredAt)),
    db.select().from(s.customerConsents).where(eq(s.customerConsents.customerId, customerId)),
    db
      .select()
      .from(s.customerNotes)
      .where(eq(s.customerNotes.customerId, customerId))
      .orderBy(desc(s.customerNotes.pinned), desc(s.customerNotes.createdAt)),
  ]);

  // One person across channels: every number and address they are known by,
  // records that may be the same person, and what the record says about them.
  const [handles, matches, merges] = await Promise.all([handlesOf(customerId), matchesFor(brandId, customerId), mergesInto(brandId, customerId)]);

  const scoreRow = scoreRows[0] ?? null;

  // What the AI has actually learned about this customer, drawn from the
  // record rather than written by hand: the axes it moved furthest, the
  // actions it has taken, and the intents it has had to escalate.
  const escalated = conversations.filter((c) => c.contained === false);
  const intents = new Map<string, number>();
  for (const c of escalated) {
    if (!c.intent) continue;
    intents.set(c.intent, (intents.get(c.intent) ?? 0) + 1);
  }

  const learned: string[] = [];
  const highest = [...signals].sort((a, b) => b.signal.value - a.signal.value)[0];
  if (highest) {
    learned.push(
      `${highest.axis.label} sits at ${Math.round(highest.signal.value)} of 100 — the strongest single input to their score.`,
    );
  }
  if (escalated.length) {
    learned.push(
      `${escalated.length} of their last ${conversations.length} contacts needed a person, most often about ${[...intents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "an unclassified intent"}.`,
    );
  }
  const openRecords = records.filter((r) => /reschedul|disput|overdue|open|scheduled/i.test(r.status ?? ""));
  if (openRecords.length) {
    learned.push(
      `${openRecords.length} record${openRecords.length === 1 ? " is" : "s are"} still open across ${new Set(openRecords.map((r) => r.sourceSystem)).size} connected system${new Set(openRecords.map((r) => r.sourceSystem)).size === 1 ? "" : "s"}.`,
    );
  }
  const sentiments = conversations.map((c) => c.sentimentEnd).filter((x): x is number => x !== null);
  if (sentiments.length >= 2) {
    const recent = sentiments.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, sentiments.length);
    learned.push(
      `Sentiment across their recent contacts averages ${recent >= 0 ? "+" : ""}${recent.toFixed(2)}.`,
    );
  }

  // The score's own history, for the "how did this move" line on the profile.
  const history = scoreRows
    .map((row) => ({
      at: row.computedAt,
      blended: Math.round(row.blended),
    }))
    .reverse();

  return {
    customer,
    score: scoreRow,
    scoreHistory: history,
    signals,
    conversations,
    records,
    consents,
    notes,
    learned,
    handles,
    matches,
    merges,
    profile,
  };
}
