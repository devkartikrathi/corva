import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";

/**
 * What a customer's record says about them, computed — never typed in.
 *
 * The measurements are the same for every business: contacts by channel,
 * orders and their rhythm, value, issues, where they are staying. What they
 * *mean* depends on the kind of business — a laundry lives on regulars and
 * notices when one goes quiet; a coaching institute works an enquiry hard
 * until it enrols. So each kind of business has a model, and the model turns
 * the numbers into a segment ("Regular", "Lapsing", "Short stay",
 * "Considering"…) with the reason in words, and into the priority engine's
 * signals with weights that fit it. See docs/CUSTOMER-PROFILES.md.
 */

export type ProfileModel = "repeat" | "pipeline" | "appointments";

type Kind = {
  model: ProfileModel;
  /** Repeat: the longest usual gap between orders that still makes someone a regular. */
  regularGapDays: number;
  /** What an order is called here, and what a won customer is. */
  order: [string, string];
  won: string;
  open: string;
};

const KINDS: Record<string, Kind> = {
  laundry: { model: "repeat", regularGapDays: 21, order: ["order", "orders"], won: "Customer", open: "Enquiry" },
  retail: { model: "repeat", regularGapDays: 45, order: ["order", "orders"], won: "Customer", open: "Enquiry" },
  home_services: { model: "repeat", regularGapDays: 120, order: ["job", "jobs"], won: "Customer", open: "Enquiry" },
  general: { model: "repeat", regularGapDays: 60, order: ["order", "orders"], won: "Customer", open: "Enquiry" },
  education: { model: "pipeline", regularGapDays: 0, order: ["enrolment", "enrolments"], won: "Enrolled", open: "Considering" },
  real_estate: { model: "pipeline", regularGapDays: 0, order: ["purchase", "purchases"], won: "Client", open: "Active buyer" },
  clinic: { model: "appointments", regularGapDays: 0, order: ["visit", "visits"], won: "Returning patient", open: "New patient" },
};
export const profileKind = (industry: string | null | undefined) => KINDS[industry ?? ""] ?? KINDS.general;

/** The segments a business of this kind sorts customers into — for offers that exclude some of them. */
export function segmentsFor(industry: string | null | undefined): string[] {
  const kind = profileKind(industry);
  if (kind.model === "repeat") return ["Short stay", "New", "Regular", "Occasional", "Lapsing"];
  if (kind.model === "pipeline") return ["Enquiry", kind.open, kind.won];
  return [kind.open, kind.won, "Due for recall"];
}

/** Weights for the priority engine, per model. Seeded once per business; owners can tune them after. */
export const DEFAULT_WEIGHTS: Record<ProfileModel, Record<string, number>> = {
  repeat: { revenue_ltv: 0.35, churn_risk: 0.3, escalation_likelihood: 0.2, sentiment: 0.15 },
  pipeline: { churn_risk: 0.35, escalation_likelihood: 0.25, revenue_ltv: 0.15, engagement: 0.15, sentiment: 0.1 },
  appointments: { churn_risk: 0.3, escalation_likelihood: 0.3, sentiment: 0.2, revenue_ltv: 0.2 },
};

export type Profile = {
  model: ProfileModel;
  segment: { label: string; why: string };
  contacts: { total: number; d30: number; d90: number; byChannel: Record<string, number>; preferred: string | null; firstAt: string | null; lastAt: string | null };
  orders: {
    count: number;
    firstAt: string | null;
    lastAt: string | null;
    totalPaise: number;
    avgPaise: number | null;
    usualGapDays: number | null;
    daysSinceLast: number | null;
    overdue: boolean;
    trend: "more often" | "less often" | "steady" | null;
  };
  valuePaise: number;
  issues: { escalations90d: number; openFollowUps: number; openLeads: number; won: boolean; sentiment: number | null; quietDays: number | null };
  stay: { kind: "short_stay" | "local" | "unknown"; evidence: string | null };
  computedAt: string;
};

/** Channels as people say them. A website voice call is a `phone` conversation with a `web-voice:` reference. */
export function channelLabel(channel: string, externalRef?: string | null) {
  if (channel === "phone") return externalRef?.startsWith("web-voice:") ? "web voice" : "phone";
  return { web_chat: "web chat", whatsapp: "WhatsApp", email: "email", sms: "SMS", survey: "survey" }[channel] ?? channel;
}

/**
 * A place someone stays for a few days rather than lives: a hotel, a PG, a
 * hostel, a rental stay. Read from what they gave as their address.
 */
const SHORT_STAY =
  /\b(hotel|hostel|paying guest|p\.?g\.?(?= |,|$)|guest ?house|air ?bnb|oyo|treebo|fab ?hotel|zostel|serviced apartments?|homestay|lodge|resort|inn|marriott|hyatt|radisson|taj|itc|novotel|lemon tree|ibis|holiday inn|staying (here )?(for|till|until)|for (a )?(few|couple of|\d+) (days|nights)|in town for)\b/i;

export function stayFrom(texts: (string | null | undefined)[]): Profile["stay"] {
  const said = texts.filter((t): t is string => Boolean(t?.trim()));
  for (const t of said) {
    const hit = t.match(SHORT_STAY);
    if (hit) return { kind: "short_stay", evidence: t.slice(0, 120) };
  }
  return said.length ? { kind: "local", evidence: null } : { kind: "unknown", evidence: null };
}

const DAY = 864e5;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Compute one customer's profile from their record, and write it — segment, value, signals. */
export async function refreshProfile(customerId: string): Promise<Profile | null> {
  const [row] = await db
    .select({ customer: s.customers, industry: s.brands.industry })
    .from(s.customers)
    .innerJoin(s.brands, eq(s.brands.id, s.customers.brandId))
    .where(eq(s.customers.id, customerId))
    .limit(1);
  if (!row) return null;
  const { customer } = row;
  const kind = profileKind(row.industry);
  const now = Date.now();

  const [conversations, records, payments, leads, followUps] = await Promise.all([
    db
      .select({
        channel: s.conversations.channel,
        externalRef: s.conversations.externalRef,
        startedAt: s.conversations.startedAt,
        outcome: s.conversations.outcome,
        sentimentEnd: s.conversations.sentimentEnd,
        captured: s.conversations.captured,
      })
      .from(s.conversations)
      .where(and(eq(s.conversations.customerId, customerId), eq(s.conversations.isTest, false)))
      .orderBy(desc(s.conversations.startedAt)),
    db.select().from(s.customerRecords).where(eq(s.customerRecords.customerId, customerId)),
    db
      .select({ status: s.customerPayments.status, paid: s.customerPayments.amountPaidPaise, amount: s.customerPayments.amountPaise, at: s.customerPayments.createdAt })
      .from(s.customerPayments)
      .where(eq(s.customerPayments.customerId, customerId)),
    db.select({ stage: s.leads.stage, updatedAt: s.leads.updatedAt }).from(s.leads).where(eq(s.leads.customerId, customerId)),
    db.select({ status: s.followUps.status }).from(s.followUps).where(eq(s.followUps.customerId, customerId)),
  ]);

  // Contact, across every channel.
  const byChannel: Record<string, number> = {};
  for (const c of conversations) {
    const label = channelLabel(c.channel, c.externalRef);
    byChannel[label] = (byChannel[label] ?? 0) + 1;
  }
  const preferred = Object.entries(byChannel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const ages = conversations.map((c) => (now - c.startedAt.getTime()) / DAY);
  const contacts = {
    total: conversations.length,
    d30: ages.filter((a) => a <= 30).length,
    d90: ages.filter((a) => a <= 90).length,
    byChannel,
    preferred,
    firstAt: conversations.at(-1)?.startedAt.toISOString() ?? null,
    lastAt: conversations[0]?.startedAt.toISOString() ?? null,
  };

  // Orders: what the business's own system sent, less anything cancelled.
  const cancelled = (r: (typeof records)[number]) =>
    /cancel/i.test(r.status ?? "") || /cancel/i.test(String((r.meta as Record<string, unknown>)?.stage ?? ""));
  const orders = records
    .filter((r) => ["order", "booking", "delivery", "subscription"].includes(r.kind) && !cancelled(r))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const times = orders.map((o) => o.occurredAt.getTime());
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY);
  const usualGap = median(gaps);
  const daysSinceLast = times.length ? Math.floor((now - times[times.length - 1]) / DAY) : null;
  const overdue = Boolean(usualGap && orders.length >= 2 && daysSinceLast != null && daysSinceLast > Math.max(usualGap * 1.5, usualGap + 3));
  let trend: Profile["orders"]["trend"] = null;
  if (gaps.length >= 4) {
    const half = Math.floor(gaps.length / 2);
    const early = median(gaps.slice(0, half))!;
    const late = median(gaps.slice(half))!;
    trend = late < early * 0.75 ? "more often" : late > early * 1.33 ? "less often" : "steady";
  }
  const orderTotal = orders.reduce((sum, o) => sum + (o.amountPaise ?? 0), 0);
  const paidTotal = payments.reduce((sum, p) => sum + (p.paid ?? 0), 0);
  // Orders carry the value when they have amounts; otherwise what was paid through Corva.
  const valuePaise = orderTotal > 0 ? orderTotal : paidTotal;

  const escalations90d = conversations.filter((c, i) => ages[i] <= 90 && c.outcome === "escalated").length;
  const sentiments = conversations.slice(0, 5).map((c) => c.sentimentEnd).filter((x): x is number => x != null);
  const openLeads = leads.filter((l) => ["new", "contacted", "qualified", "proposal"].includes(l.stage));
  const won = leads.some((l) => l.stage === "won") || payments.some((p) => p.status === "paid") || orders.length > 0;
  const quietDays = contacts.lastAt ? Math.floor((now - new Date(contacts.lastAt).getTime()) / DAY) : null;
  const issues = {
    escalations90d,
    openFollowUps: followUps.filter((f) => f.status === "open").length,
    openLeads: openLeads.length,
    won,
    sentiment: sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null,
    quietDays,
  };

  // Where they are: the address they gave, on the record or in a conversation.
  const addresses = [
    customer.location,
    ...conversations.flatMap((c) => Object.entries(c.captured ?? {}).filter(([k]) => /address|location|pickup|where/i.test(k)).map(([, v]) => String(v))),
    ...records.map((r) => (r.meta as Record<string, unknown>)?.address as string | undefined),
  ];
  const stay = stayFrom(addresses);

  const segment = segmentFor(kind, { orders: orders.length, usualGap, daysSinceLast, overdue, stay, issues, firstOrderAt: orders[0]?.occurredAt ?? null });

  const profile: Profile = {
    model: kind.model,
    segment,
    contacts,
    orders: {
      count: orders.length,
      firstAt: orders[0]?.occurredAt.toISOString() ?? null,
      lastAt: orders.at(-1)?.occurredAt.toISOString() ?? null,
      totalPaise: orderTotal,
      avgPaise: orders.length && orderTotal ? Math.round(orderTotal / orders.filter((o) => o.amountPaise != null).length) : null,
      usualGapDays: usualGap != null ? Math.round(usualGap) : null,
      daysSinceLast,
      overdue,
      trend,
    },
    valuePaise,
    issues,
    stay,
    computedAt: new Date(now).toISOString(),
  };

  await db
    .update(s.customers)
    .set({ profile, profileAt: new Date(now), segment: segment.label, ltvPaise: valuePaise })
    .where(eq(s.customers.id, customerId));
  await writeSignals(customer.brandId, customerId, profile, kind);
  const { rescoreBrand } = await import("@/lib/queries/scoring");
  await rescoreBrand(customer.brandId, [customerId]);
  return profile;
}

function segmentFor(
  kind: Kind,
  p: {
    orders: number;
    usualGap: number | null;
    daysSinceLast: number | null;
    overdue: boolean;
    stay: Profile["stay"];
    issues: Profile["issues"];
    firstOrderAt: Date | null;
  },
): Profile["segment"] {
  const [one, many] = kind.order;
  const count = `${p.orders} ${p.orders === 1 ? one : many}`;
  const gap = p.usualGap != null ? `usually every ${Math.round(p.usualGap)} days` : null;
  const last = p.daysSinceLast != null ? (p.daysSinceLast === 0 ? "last one today" : `last one ${p.daysSinceLast} day${p.daysSinceLast === 1 ? "" : "s"} ago`) : null;

  if (kind.model === "repeat") {
    if (p.stay.kind === "short_stay") return { label: "Short stay", why: `Gave an address that reads like a short stay ("${p.stay.evidence}"): likely in town briefly, not a regular.` };
    if (p.orders >= 2 && p.overdue) return { label: "Lapsing", why: `${count}, ${gap}; ${last} — past their usual time.` };
    if (p.orders >= 3 && p.usualGap != null && p.usualGap <= kind.regularGapDays) return { label: "Regular", why: [count, gap, last].filter(Boolean).join(", ") + "." };
    if (p.orders === 0) return { label: "New", why: p.issues.openLeads ? `No ${many} yet; an open enquiry.` : `No ${many} yet.` };
    if (p.orders === 1) return { label: "New", why: `First ${one} ${p.firstOrderAt ? p.firstOrderAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}.`.replace(" .", ".") };
    return { label: "Occasional", why: [count, gap, last].filter(Boolean).join(", ") + "." };
  }
  if (kind.model === "pipeline") {
    if (p.issues.won) return { label: kind.won, why: p.issues.escalations90d ? `${p.issues.escalations90d} issue${p.issues.escalations90d === 1 ? "" : "s"} needed a person in 90 days.` : "Won; support only when they ask." };
    if (p.issues.openLeads) {
      const quiet = p.issues.quietDays ?? 0;
      return { label: kind.open, why: quiet >= 3 ? `Open enquiry, no contact for ${quiet} days — needs a follow-up.` : "Open enquiry, in touch recently." };
    }
    return { label: "Enquiry", why: "Asked, nothing open yet." };
  }
  // Appointments.
  if (p.orders === 0) return { label: kind.open, why: `No ${many} recorded yet.` };
  if (p.daysSinceLast != null && p.daysSinceLast > 180) return { label: "Due for recall", why: `${count}; ${last}.` };
  return { label: kind.won, why: [count, last].filter(Boolean).join("; ") + "." };
}

/**
 * The profile as the priority engine's signals (0–100, "needs attention"
 * upward before an axis is inverted), and the business's weights for them
 * if it has never set any.
 */
async function writeSignals(brandId: string, customerId: string, p: Profile, kind: Kind) {
  const [rank] = await db
    .select({
      below: sql<number>`count(*) filter (where ${s.customers.ltvPaise} < ${p.valuePaise})::int`,
      paying: sql<number>`count(*) filter (where ${s.customers.ltvPaise} > 0)::int`,
    })
    .from(s.customers)
    .where(eq(s.customers.brandId, brandId));
  const signals: { axisKey: string; value: number; display: string }[] = [];
  if (p.valuePaise > 0) {
    const pct = rank.paying > 1 ? Math.round((rank.below / Math.max(1, rank.paying)) * 100) : 60;
    signals.push({ axisKey: "revenue_ltv", value: Math.min(100, Math.max(10, pct)), display: formatRupees(p.valuePaise) });
  } else {
    signals.push({ axisKey: "revenue_ltv", value: 0, display: "₹0" });
  }

  let churn = 20;
  let churnDisplay = "—";
  if (kind.model === "repeat" && p.orders.usualGapDays && p.orders.daysSinceLast != null) {
    const r = p.orders.daysSinceLast / p.orders.usualGapDays;
    churn = r <= 1 ? 10 : r <= 1.5 ? 40 : r <= 2 ? 70 : 90;
    churnDisplay = `${p.orders.daysSinceLast}d since last (usual ${p.orders.usualGapDays}d)`;
  } else if (kind.model === "pipeline" && !p.issues.won && p.issues.openLeads) {
    churn = Math.min(100, (p.issues.quietDays ?? 0) * 15);
    churnDisplay = `${p.issues.quietDays ?? 0}d quiet`;
  } else if (kind.model === "appointments" && p.orders.daysSinceLast != null) {
    churn = p.orders.daysSinceLast > 180 ? 80 : 20;
    churnDisplay = `${p.orders.daysSinceLast}d since last visit`;
  }
  signals.push({ axisKey: "churn_risk", value: churn, display: churnDisplay });
  signals.push({ axisKey: "engagement", value: Math.min(100, p.contacts.d90 * 20), display: `${p.contacts.d90} contacts in 90d` });
  signals.push({ axisKey: "escalation_likelihood", value: Math.min(100, p.issues.escalations90d * 35), display: `${p.issues.escalations90d} in 90d` });
  if (p.issues.sentiment != null) {
    signals.push({ axisKey: "sentiment", value: Math.round((p.issues.sentiment + 1) * 50), display: `${p.issues.sentiment >= 0 ? "+" : ""}${p.issues.sentiment.toFixed(2)}` });
  }

  await db
    .insert(s.customerSignals)
    .values(signals.map((x) => ({ customerId, ...x, computedAt: new Date() })))
    .onConflictDoUpdate({
      target: [s.customerSignals.customerId, s.customerSignals.axisKey],
      set: { value: sql`excluded.value`, display: sql`excluded.display`, computedAt: sql`excluded.computed_at` },
    });

  const [anyWeight] = await db.select({ key: s.brandAxisWeights.axisKey }).from(s.brandAxisWeights).where(eq(s.brandAxisWeights.brandId, brandId)).limit(1);
  if (!anyWeight) {
    await db
      .insert(s.brandAxisWeights)
      .values(Object.entries(DEFAULT_WEIGHTS[kind.model]).map(([axisKey, weight]) => ({ brandId, axisKey, weight })))
      .onConflictDoNothing();
  }
}

/** Profiles older than `maxAgeMs`, refreshed — for the assistant, the customer page and the nightly run. */
export async function freshProfile(customerId: string, maxAgeMs = 60 * 60_000) {
  const [row] = await db.select({ profile: s.customers.profile, at: s.customers.profileAt }).from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
  if (row?.at && Date.now() - row.at.getTime() < maxAgeMs && row.profile && "segment" in row.profile) return row.profile as unknown as Profile;
  return refreshProfile(customerId);
}

/** Every customer of a business, then their priority scores. */
export async function refreshBrandProfiles(brandId: string) {
  const ids = await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.brandId, brandId));
  for (const { id } of ids) await refreshProfile(id);
  return ids.length;
}

/** One line for the assistant: who this is to the business. */
export function profileLine(p: Profile) {
  const parts = [`${p.segment.label} — ${p.segment.why}`];
  if (p.valuePaise > 0) parts.push(`Value so far ${formatRupees(p.valuePaise)}.`);
  if (p.orders.trend && p.orders.trend !== "steady") parts.push(`Ordering ${p.orders.trend} than before.`);
  if (p.contacts.preferred && p.contacts.total > 1) parts.push(`Usually reaches us by ${p.contacts.preferred}.`);
  if (p.issues.escalations90d) parts.push(`${p.issues.escalations90d} issue${p.issues.escalations90d === 1 ? "" : "s"} needed a person in the last 90 days.`);
  return parts.join(" ");
}
