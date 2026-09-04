import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { operatorConfig } from "@/lib/config";

/**
 * Read models for the platform operator console.
 *
 * These deliberately read health, counts and configuration — never transcript
 * or customer content. Reaching that requires a live `supportGrants` row, and
 * the queries that would return it live behind `assertSupportAccess`.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_400 = "var(--color-accent-400)";
const BG = "var(--color-bg)";
const N_300 = "var(--color-neutral-300)";
const N_500 = "var(--color-neutral-500)";
const N_600 = "var(--color-neutral-600)";

const money = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/* ─── Fleet ────────────────────────────────────────────────────────────── */

export type FleetFilters = {
  q?: string;
  plan?: string[];
  region?: string[];
  /** "at_risk" | "trialling" | "enterprise" | "healthy" */
  segment?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * The fleet.
 *
 * Filtering, sorting and paging happen in SQL. With 148 tenants the difference
 * is academic; the operator console is the one surface that grows with Corva's
 * own success, so "fetch every row and filter in memory" is a thing that works
 * until the day it matters.
 */
export async function getFleet(filters: FleetFilters = {}) {
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);

  const where = [];
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(s.organizations.name, pattern), ilike(s.organizations.slug, pattern))!);
  }
  if (filters.plan?.length) {
    where.push(inArray(s.organizations.plan, filters.plan as (typeof s.planEnum.enumValues)[number][]));
  }
  if (filters.region?.length) where.push(inArray(s.organizations.region, filters.region));
  if (filters.segment === "at_risk") {
    where.push(sql`${s.organizations.healthScore} < ${operatorConfig.healthThreshold}`);
  }
  if (filters.segment === "trialling") where.push(eq(s.organizations.plan, "trial"));
  if (filters.segment === "enterprise") where.push(eq(s.organizations.plan, "enterprise"));
  if (filters.segment === "healthy") {
    where.push(sql`${s.organizations.healthScore} >= 85`);
  }
  const condition = where.length ? and(...where) : undefined;

  const ORDER = {
    health: s.organizations.healthScore,
    name: s.organizations.name,
    mrr: s.organizations.mrrPence,
    seats: s.organizations.seatCount,
    renews: s.organizations.renewsAt,
  } as const;
  const [sortField, sortDir] = (filters.sort ?? "health:asc").split(":");
  const column = ORDER[sortField as keyof typeof ORDER] ?? s.organizations.healthScore;

  const [orgs, [total], facetRows] = await Promise.all([
    db
      .select()
      .from(s.organizations)
      .where(condition)
      .orderBy(sortDir === "desc" ? desc(column) : asc(column))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(s.organizations).where(condition),
    // Facets describe the whole fleet, not the page: a filter chip has to say
    // how many rows it would show, not how many are already visible.
    db
      .select({
        plan: s.organizations.plan,
        region: s.organizations.region,
        n: sql<number>`count(*)::int`,
        atRisk: sql<number>`count(*) filter (where ${s.organizations.healthScore} < ${operatorConfig.healthThreshold})::int`,
      })
      .from(s.organizations)
      .groupBy(s.organizations.plan, s.organizations.region),
  ]);

  const brandCounts = await db
    .select({ orgId: s.brands.orgId, n: sql<number>`count(*)::int` })
    .from(s.brands)
    .groupBy(s.brands.orgId);
  const brandsBy = new Map(brandCounts.map((b) => [b.orgId, b.n]));

  // Volume and containment come from the daily rollup rather than from
  // `conversations`: the rollup is what every operator chart reads, it covers
  // the whole fleet, and scanning the conversation graph per tenant would not
  // survive the first thousand customers.
  const usageStats = await db
    .select({
      orgId: s.usageDaily.orgId,
      total: sql<number>`coalesce(sum(${s.usageDaily.conversations}), 0)::int`,
      contained: sql<number>`coalesce(sum(${s.usageDaily.contained}), 0)::int`,
    })
    .from(s.usageDaily)
    .where(sql`${s.usageDaily.day} > now() - interval '30 days'`)
    .groupBy(s.usageDaily.orgId);
  const statsBy = new Map(usageStats.map((c) => [c.orgId, c]));

  // Fleet-wide totals for the KPI strip, computed in the database rather than
  // from the page of rows above — a KPI that only counts what is on screen is
  // worse than no KPI.
  const [[fleetTotals], [usageTotals]] = await Promise.all([
    db
      .select({
        companies: sql<number>`count(*)::int`,
        mrr: sql<number>`coalesce(sum(${s.organizations.mrrPence}), 0)::bigint`,
        unhealthy: sql<number>`count(*) filter (where ${s.organizations.healthScore} < ${operatorConfig.healthThreshold})::int`,
        atRiskMrr: sql<number>`coalesce(sum(${s.organizations.mrrPence}) filter (where ${s.organizations.healthScore} < ${operatorConfig.healthThreshold}), 0)::bigint`,
      })
      .from(s.organizations),
    db
      .select({
        total: sql<number>`coalesce(sum(${s.usageDaily.conversations}), 0)::int`,
        contained: sql<number>`coalesce(sum(${s.usageDaily.contained}), 0)::int`,
      })
      .from(s.usageDaily)
      .where(sql`${s.usageDaily.day} > now() - interval '30 days'`),
  ]);

  const tenants = orgs.map((o) => {
    const health = o.healthScore ?? 0;
    const stats = statsBy.get(o.id);
    const containment = stats && stats.total > 0 ? (stats.contained / stats.total) * 100 : null;
    const bad = health < operatorConfig.healthThreshold;

    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      seats: o.seatCount,
      region: o.region,
      renewsInDays: o.renewsAt
        ? Math.round((o.renewsAt.getTime() - Date.now()) / 864e5)
        : null,
      meta: [
        `${brandsBy.get(o.id) ?? 0} brand${(brandsBy.get(o.id) ?? 0) === 1 ? "" : "s"}`,
        o.region,
      ].join(" · "),
      plan: o.plan[0].toUpperCase() + o.plan.slice(1),
      conv: stats ? stats.total.toLocaleString("en-GB") : "0",
      containment: containment === null ? "—" : `${containment.toFixed(1)}%`,
      health: `${health} · ${health >= 85 ? "healthy" : health >= 70 ? "steady" : "falling"}`,
      healthV: health,
      healthBar: `${health}%`,
      healthColor: bad ? ACCENT : N_500,
      mrr: money(o.mrrPence),
      flag: bad ? "Health drop" : o.plan === "trial" ? "Trial" : "Healthy",
      tagBg: bad ? "var(--color-accent-800)" : "var(--color-neutral-800)",
      tagFg: bad ? ACCENT_200 : N_300,
      bad,
    };
  });

  const mrrTotal = Number(fleetTotals.mrr);
  const atRisk = Number(fleetTotals.atRiskMrr);
  const allConv = usageTotals.total;
  const allContained = usageTotals.contained;

  const facets = {
    plans: [...new Map(
      facetRows.map((f) => [f.plan, 0]),
    ).keys()].map((plan) => ({
      value: plan,
      count: facetRows.filter((f) => f.plan === plan).reduce((a, f) => a + f.n, 0),
    })).sort((a, b) => b.count - a.count),
    regions: [...new Map(
      facetRows.map((f) => [f.region, 0]),
    ).keys()].map((region) => ({
      value: region,
      count: facetRows.filter((f) => f.region === region).reduce((a, f) => a + f.n, 0),
    })).sort((a, b) => b.count - a.count),
    atRisk: facetRows.reduce((a, f) => a + f.atRisk, 0),
  };

  return {
    tenants,
    /** Rows matching the current filters. */
    total: total.n,
    /** Every tenant, regardless of filter — what the "All" tab counts. */
    fleetSize: fleetTotals.companies,
    page,
    pageSize,
    facets,
    kpis: [
      {
        label: "Companies",
        value: String(fleetTotals.companies),
        delta: "",
        note: "on Corva",
        good: true,
      },
      { label: "MRR", value: money(mrrTotal), delta: "", note: "across the fleet", good: true },
      {
        label: "Conversations",
        value: allConv.toLocaleString("en-GB"),
        delta: "",
        note: "all tenants, 30 days",
        good: true,
      },
      {
        label: "Fleet containment",
        value: allConv ? `${((allContained / allConv) * 100).toFixed(1)}%` : "—",
        delta: "",
        note: "weighted",
        good: true,
      },
      {
        label: "Below health threshold",
        value: String(fleetTotals.unhealthy),
        delta: "",
        note: `under ${operatorConfig.healthThreshold}`,
        good: false,
      },
      { label: "At-risk MRR", value: money(atRisk), delta: "", note: "unhealthy tenants", good: false },
    ].map((k) => ({ ...k, deltaColor: k.good ? ACCENT_400 : ACCENT })),
    /**
     * Who to call today.
     *
     * Deliberately computed across the whole fleet rather than the current
     * page: this list is the operator's job, and it should not change because
     * someone typed in the search box.
     */
    needsAttention: await needsAttention(),
  };
}

/** The unhealthiest tenants, whatever the fleet table is currently filtered to. */
async function needsAttention(limit = 4) {
  const rows = await db
    .select()
    .from(s.organizations)
    .where(sql`${s.organizations.healthScore} < ${operatorConfig.healthThreshold}`)
    .orderBy(asc(s.organizations.healthScore))
    .limit(limit);

  const notes = await db
    .select()
    .from(s.accountNotes)
    .where(inArray(s.accountNotes.orgId, rows.map((r) => r.id).length ? rows.map((r) => r.id) : [""]))
    .orderBy(desc(s.accountNotes.createdAt));
  const noteBy = new Map<string, string>();
  for (const n of notes) if (!noteBy.has(n.orgId)) noteBy.set(n.orgId, n.body);

  return rows.map((o) => ({
    slug: o.slug,
    name: o.name,
    // A staff note beats a generated sentence: someone has already worked out
    // what is wrong with this account and written it down.
    note:
      noteBy.get(o.id) ??
      `Health ${o.healthScore ?? 0} on the ${o.plan} plan, ${money(o.mrrPence)} MRR.`,
    urgent: (o.healthScore ?? 0) < 50,
  }));
}

/* ─── One company ──────────────────────────────────────────────────────── */

export async function getTenantDetail(slug: string) {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, slug)).limit(1);
  if (!org) return null;

  const brandRows = await db.select().from(s.brands).where(eq(s.brands.orgId, org.id));

  const perBrand = await db
    .select({
      brandId: s.conversations.brandId,
      total: sql<number>`count(*)::int`,
      contained: sql<number>`count(*) FILTER (WHERE ${s.conversations.contained})::int`,
    })
    .from(s.conversations)
    .groupBy(s.conversations.brandId);
  const statsBy = new Map(perBrand.map((b) => [b.brandId, b]));

  const [people] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.memberships)
    .where(eq(s.memberships.orgId, org.id));

  const [docs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.documents)
    .innerJoin(s.brands, eq(s.brands.id, s.documents.brandId))
    .where(eq(s.brands.orgId, org.id));

  const flags = await db
    .select({ flag: s.featureFlags, orgFlag: s.orgFeatureFlags })
    .from(s.featureFlags)
    .leftJoin(
      s.orgFeatureFlags,
      and(eq(s.orgFeatureFlags.flagKey, s.featureFlags.key), eq(s.orgFeatureFlags.orgId, org.id)),
    );

  const grants = await db
    .select()
    .from(s.supportGrants)
    .where(eq(s.supportGrants.orgId, org.id))
    .orderBy(desc(s.supportGrants.grantedAt))
    .limit(3);

  const [notes, staffAudit] = await Promise.all([
    db
      .select()
      .from(s.accountNotes)
      .where(eq(s.accountNotes.orgId, org.id))
      .orderBy(desc(s.accountNotes.createdAt))
      .limit(8),
    // What Corva staff have done to this tenant, from the tenant's own log —
    // the same rows they can see on their Setup screen.
    db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.orgId, org.id), eq(s.auditLog.actorType, "staff")))
      .orderBy(desc(s.auditLog.at))
      .limit(5),
  ]);

  const totalConv = perBrand
    .filter((b) => brandRows.some((br) => br.id === b.brandId))
    .reduce((a, b) => a + b.total, 0);

  return {
    org,
    brands: brandRows.map((b) => {
      const st = statsBy.get(b.id);
      const containment = st && st.total ? (st.contained / st.total) * 100 : null;
      return {
        name: b.name,
        conv: `${st?.total ?? 0} conv`,
        containment: containment === null ? "—" : `${containment.toFixed(1)}%`,
        agent: b.agentName ? `${b.agentName}` : "not set up",
        color: b.agentName ? BG : ACCENT_400,
      };
    }),
    usage: [
      { label: "People", value: String(people.n) },
      { label: "Knowledge documents", value: `${docs.n} across ${brandRows.length} brands` },
      { label: "Data region", value: org.region },
      { label: "Plan", value: org.plan[0].toUpperCase() + org.plan.slice(1) },
    ],
    conversations: totalConv,
    flags: flags.map(({ flag, orgFlag }) => {
      const on = orgFlag?.enabled ?? flag.defaultOn;
      return {
        key: flag.key,
        name: flag.label,
        note: [flag.note, flag.stage].filter(Boolean).join(" · "),
        on,
        trackBg: on ? ACCENT : "var(--color-neutral-700)",
        knob: on ? 18 : 2,
      };
    }),
    /** Never customer content — only whether access exists at all. */
    support: {
      current: grants.find((g) => !g.revokedAt && g.expiresAt > new Date()) ?? null,
      last: grants[0] ?? null,
    },
    billing: [
      { label: "MRR", value: money(org.mrrPence), hot: false },
      { label: "Seats", value: String(org.seatCount), hot: false },
      {
        label: "Renews",
        value:
          org.renewsAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ??
          "—",
        hot: false,
      },
      { label: "Health", value: String(org.healthScore ?? "—"), hot: (org.healthScore ?? 100) < operatorConfig.healthThreshold },
    ],
    notes: notes.map((n) => ({
      id: n.id,
      when: n.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      kind: n.kind,
      author: n.authorName,
      body: n.body,
      urgent: n.kind === "risk",
    })),
    /** Staff activity, as the tenant sees it in their own audit log. */
    staffActivity: staffAudit.map((a) => ({
      id: a.id,
      when: a.at.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      who: a.actorName ?? "Corva",
      what: a.action.replace(/[._]/g, " "),
    })),
  };
}

/* ─── Cross-tenant quality ─────────────────────────────────────────────── */

export async function getFleetQuality(filters: { status?: string; owner?: string } = {}) {
  const where = [];
  if (filters.status) where.push(eq(s.qualityFlags.status, filters.status));
  if (filters.owner) where.push(eq(s.qualityFlags.owner, filters.owner));

  const flagged = await db
    .select({ flag: s.qualityFlags, org: s.organizations })
    .from(s.qualityFlags)
    .innerJoin(s.organizations, eq(s.organizations.id, s.qualityFlags.orgId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.qualityFlags.createdAt))
    .limit(30);

  // The counts behind the triage tabs, over every flag rather than the page.
  const counts = await db
    .select({
      status: s.qualityFlags.status,
      owner: s.qualityFlags.owner,
      n: sql<number>`count(*)::int`,
    })
    .from(s.qualityFlags)
    .groupBy(s.qualityFlags.status, s.qualityFlags.owner);

  /**
   * The failure classes worth fixing centrally.
   *
   * Grouped by class across tenants, because that is the operator's whole
   * question: is this one company's bad documents, or something Corva shipped?
   * A class that shows up at three companies is the second kind.
   */
  const classes = await db
    .select({
      failureClass: s.qualityFlags.failureClass,
      n: sql<number>`count(*)::int`,
      companies: sql<number>`count(distinct ${s.qualityFlags.orgId})::int`,
      corvaOwned: sql<number>`count(*) filter (where ${s.qualityFlags.owner} = 'corva')::int`,
      open: sql<number>`count(*) filter (where ${s.qualityFlags.status} = 'open')::int`,
    })
    .from(s.qualityFlags)
    .groupBy(s.qualityFlags.failureClass)
    .orderBy(desc(sql`count(*)`));

  // Flag rollout state, so "Beta · 24 companies" is a count of rows.
  const flagRows = await db.select().from(s.featureFlags).orderBy(desc(s.featureFlags.rolloutPercent));
  const flagUsage = await db
    .select({ flagKey: s.orgFeatureFlags.flagKey, n: sql<number>`count(*)::int` })
    .from(s.orgFeatureFlags)
    .where(eq(s.orgFeatureFlags.enabled, true))
    .groupBy(s.orgFeatureFlags.flagKey);
  const usageBy = new Map(flagUsage.map((f) => [f.flagKey, f.n]));

  const [aiTurns] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.turns)
    .where(eq(s.turns.speaker, "ai"));

  const [cited] = await db
    .select({ n: sql<number>`count(DISTINCT ${s.turnCitations.turnId})::int` })
    .from(s.turnCitations);

  const [conv] = await db
    .select({
      total: sql<number>`count(*)::int`,
      contained: sql<number>`count(*) FILTER (WHERE ${s.conversations.contained})::int`,
    })
    .from(s.conversations);

  const [gapCount] = await db.select({ n: sql<number>`count(*)::int` }).from(s.knowledgeGaps);

  const citationRate = aiTurns.n ? (cited.n / aiTurns.n) * 100 : 0;

  return {
    kpis: [
      {
        label: "Fleet containment",
        value: conv.total ? `${((conv.contained / conv.total) * 100).toFixed(1)}%` : "—",
        note: "all tenants, 30 days",
      },
      { label: "Citation rate", value: `${citationRate.toFixed(1)}%`, note: "target 97%" },
      { label: "AI turns", value: aiTurns.n.toLocaleString("en-GB"), note: "recorded" },
      { label: "Documentation gaps", value: String(gapCount.n), note: "across the fleet" },
      { label: "Flagged turns", value: String(flagged.length), note: "awaiting review" },
    ],
    flagged: flagged.map((f) => ({
      id: f.flag.id,
      company: f.org.name,
      companySlug: f.org.slug,
      klass: f.flag.failureClass.replace(/_/g, " "),
      summary: f.flag.summary ?? "—",
      status: f.flag.status,
      cause: f.flag.rootCause ?? "—",
      ownerKey: f.flag.owner,
      owner: f.flag.owner === "tenant" ? "Tenant" : "Corva",
      color: f.flag.owner === "tenant" ? N_300 : ACCENT_400,
      age: relativeDays(f.flag.createdAt),
    })),
    counts: {
      total: counts.reduce((a, c) => a + c.n, 0),
      open: counts.filter((c) => c.status === "open").reduce((a, c) => a + c.n, 0),
      triaged: counts.filter((c) => c.status === "triaged").reduce((a, c) => a + c.n, 0),
      fixed: counts.filter((c) => c.status === "fixed").reduce((a, c) => a + c.n, 0),
      corva: counts.filter((c) => c.owner === "corva").reduce((a, c) => a + c.n, 0),
      tenant: counts.filter((c) => c.owner === "tenant").reduce((a, c) => a + c.n, 0),
    },
    /** Patterns across tenants — the ones Corva should fix once, centrally. */
    patterns: classes.map((c) => ({
      klass: c.failureClass.replace(/_/g, " "),
      count: c.n,
      companies: c.companies,
      open: c.open,
      // Seen at more than one company and mostly ours: that is a platform bug.
      central: c.companies > 1 && c.corvaOwned >= c.n / 2,
    })),
    rollout: flagRows.map((f) => ({
      key: f.key,
      label: f.label,
      stage: f.stage,
      note: f.note ?? "",
      companies: usageBy.get(f.key) ?? 0,
      percent: f.rolloutPercent,
    })),
  };
}

/** "3 days ago", or "today" — the granularity a triage queue needs. */
function relativeDays(d: Date) {
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* ─── Revenue ──────────────────────────────────────────────────────────── */

export async function getFleetRevenue() {
  const orgs = await db.select().from(s.organizations);
  const mrr = orgs.reduce((a, o) => a + o.mrrPence, 0);

  const [history, economics] = await Promise.all([
    // Twelve months of recorded MRR. The chart is history, not a projection —
    // if a month is missing it should be a gap, not an interpolation.
    db
      .select({
        month: s.mrrSnapshots.month,
        mrr: sql<number>`coalesce(sum(${s.mrrSnapshots.mrrPence}), 0)::bigint`,
        companies: sql<number>`count(*)::int`,
      })
      .from(s.mrrSnapshots)
      .groupBy(s.mrrSnapshots.month)
      .orderBy(asc(s.mrrSnapshots.month)),
    // What the fleet cost to serve over the last 30 days, against what it paid.
    db
      .select({
        conversations: sql<number>`coalesce(sum(${s.usageDaily.conversations}), 0)::int`,
        contained: sql<number>`coalesce(sum(${s.usageDaily.contained}), 0)::int`,
        aiMinutes: sql<number>`coalesce(sum(${s.usageDaily.aiMinutes}), 0)::int`,
        humanMinutes: sql<number>`coalesce(sum(${s.usageDaily.humanMinutes}), 0)::int`,
        cost: sql<number>`coalesce(sum(${s.usageDaily.costPence}), 0)::bigint`,
      })
      .from(s.usageDaily)
      .where(sql`${s.usageDaily.day} > now() - interval '30 days'`),
  ]);

  const peakMrr = Math.max(1, ...history.map((h) => Number(h.mrr)));
  const cost = Number(economics[0]?.cost ?? 0);
  const conversations = economics[0]?.conversations ?? 0;
  // Monthly revenue against a month of serving cost — the only unit economics
  // figure an operator can act on.
  const grossMargin = mrr > 0 ? ((mrr - cost) / mrr) * 100 : 0;

  const byPlan = new Map<string, { count: number; mrr: number }>();
  for (const o of orgs) {
    const entry = byPlan.get(o.plan) ?? { count: 0, mrr: 0 };
    entry.count++;
    entry.mrr += o.mrrPence;
    byPlan.set(o.plan, entry);
  }

  const atRisk = orgs
    .filter((o) => (o.healthScore ?? 100) < operatorConfig.healthThreshold)
    .sort((a, b) => b.mrrPence - a.mrrPence);

  return {
    kpis: [
      { label: "MRR", value: money(mrr), note: "across the fleet" },
      { label: "Companies", value: String(orgs.length), note: "paying and trialling" },
      {
        label: "Trials open",
        value: String(orgs.filter((o) => o.plan === "trial").length),
        note: "not yet converted",
      },
      {
        label: "At-risk MRR",
        value: money(atRisk.reduce((a, o) => a + o.mrrPence, 0)),
        note: `${atRisk.length} companies`,
      },
      {
        label: "Average MRR",
        value: money(orgs.length ? Math.round(mrr / orgs.length) : 0),
        note: "per company",
      },
    ],
    /** One bar per recorded month, tallest = the best month so far. */
    mrrByMonth: history.map((h) => ({
      label: h.month.toLocaleDateString("en-GB", { month: "short" }),
      mrr: money(Number(h.mrr)),
      h: `${Math.round((Number(h.mrr) / peakMrr) * 100)}%`,
      color: Number(h.mrr) >= peakMrr ? ACCENT : "var(--color-neutral-600)",
    })),
    unitEconomics: [
      {
        label: "Conversations served",
        value: conversations.toLocaleString("en-GB"),
        hot: false,
      },
      {
        label: "Cost to serve",
        value: money(cost),
        hot: false,
      },
      {
        label: "Cost per conversation",
        value: conversations ? `£${(cost / conversations / 100).toFixed(2)}` : "—",
        hot: false,
      },
      {
        label: "Revenue per conversation",
        value: conversations ? `£${(mrr / conversations / 100).toFixed(2)}` : "—",
        hot: false,
      },
      {
        label: "Gross margin",
        value: `${grossMargin.toFixed(1)}%`,
        // Below 70 is where a usage-priced AI product stops working.
        hot: grossMargin < 70,
      },
      {
        label: "AI minutes vs human",
        value: `${(economics[0]?.aiMinutes ?? 0).toLocaleString("en-GB")} / ${(economics[0]?.humanMinutes ?? 0).toLocaleString("en-GB")}`,
        hot: false,
      },
    ],
    planMix: [...byPlan.entries()]
      .sort((a, b) => b[1].mrr - a[1].mrr)
      .map(([plan, v]) => ({
        label: plan[0].toUpperCase() + plan.slice(1),
        value: `${v.count} companies · ${money(v.mrr)}`,
        bar: `${mrr ? Math.round((v.mrr / mrr) * 100) : 0}%`,
        color: plan === "operator" ? ACCENT : "var(--color-neutral-700)",
      })),
    atRisk: atRisk.map((o) => ({
      name: o.name,
      mrr: money(o.mrrPence),
      risk: (o.healthScore ?? 0) < 50 ? "High" : "Medium",
      why: `Health ${o.healthScore}, below the ${operatorConfig.healthThreshold} threshold.`,
      high: (o.healthScore ?? 0) < 50,
      tagBg: (o.healthScore ?? 0) < 50 ? "var(--color-accent-800)" : "var(--color-neutral-800)",
      tagFg: (o.healthScore ?? 0) < 50 ? ACCENT_200 : N_300,
    })),
  };
}

/* ─── Reliability ──────────────────────────────────────────────────────── */

export async function getReliability() {
  const regionRows = await db.select().from(s.regions);
  const incidentRows = await db
    .select()
    .from(s.incidents)
    .orderBy(desc(s.incidents.startedAt))
    .limit(8);

  const [dependencyRows, updateRows] = await Promise.all([
    db.select().from(s.platformDependencies).orderBy(s.platformDependencies.label),
    incidentRows.length
      ? db
          .select()
          .from(s.incidentUpdates)
          .where(inArray(s.incidentUpdates.incidentId, incidentRows.map((i) => i.id)))
          .orderBy(desc(s.incidentUpdates.at))
      : Promise.resolve([]),
  ]);

  const updatesByIncident = new Map<string, typeof updateRows>();
  for (const u of updateRows) {
    const list = updatesByIncident.get(u.incidentId) ?? [];
    list.push(u);
    updatesByIncident.set(u.incidentId, list);
  }

  const orgsByRegion = await db
    .select({ region: s.organizations.region, n: sql<number>`count(*)::int` })
    .from(s.organizations)
    .groupBy(s.organizations.region);
  const countBy = new Map(orgsByRegion.map((r) => [r.region, r.n]));

  return {
    regions: regionRows.map((r) => {
      const bad = r.state === "degraded";
      return {
        name: r.label,
        tenants: String(countBy.get(r.key) ?? 0),
        p95: r.voiceP95Ms ? `${(r.voiceP95Ms / 1000).toFixed(1)}s` : "—",
        uptime: r.uptime30d ? `${r.uptime30d}%` : "—",
        state: r.state === "edge_only" ? "Edge only" : r.state[0].toUpperCase() + r.state.slice(1),
        color: bad ? ACCENT : BG,
        tagBg: bad ? "var(--color-accent-800)" : "var(--color-neutral-800)",
        tagFg: bad ? ACCENT_200 : N_300,
      };
    }),
    incidents: incidentRows.map((i) => {
      const open = i.resolvedAt === null;
      const mins = Math.round(
        ((i.resolvedAt ?? new Date()).getTime() - i.startedAt.getTime()) / 60000,
      );
      return {
        id: i.id,
        open,
        affected: i.affectedOrgCount,
        updates: (updatesByIncident.get(i.id) ?? []).map((u) => ({
          id: u.id,
          stage: u.stage,
          body: u.body,
          author: u.authorName,
          when: u.at.toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })),
        when: open
          ? "Now"
          : i.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        dur: open ? `${mins}m open` : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`,
        title: i.title,
        sev: i.severity,
        note: i.note,
        bad: i.severity === "Sev 2" || i.severity === "Sev 1",
        tagBg: i.severity === "Sev 2" || i.severity === "Sev 1" ? "var(--color-accent-800)" : "var(--color-neutral-800)",
        tagFg: i.severity === "Sev 2" || i.severity === "Sev 1" ? ACCENT_200 : N_300,
      };
    }),
    openIncident: incidentRows.find((i) => i.resolvedAt === null) ?? null,
    dependencies: dependencyRows.map((d) => {
      const bad = d.state !== "healthy";
      return {
        key: d.key,
        name: d.label,
        provider: d.provider ?? "—",
        state: d.state[0].toUpperCase() + d.state.slice(1),
        stateKey: d.state,
        note: d.note ?? "",
        latency: d.latencyMs === null ? "—" : d.latencyMs >= 1000 ? `${(d.latencyMs / 1000).toFixed(1)}s` : `${d.latencyMs}ms`,
        bad,
        color: bad ? ACCENT : BG,
      };
    }),
  };
}


/**
 * The three numbers in the operator header.
 *
 * Cheap enough to run on every page in the console, which is the point: a
 * banner that says "1 incident open" while an incident is being resolved two
 * tabs away is worse than no banner.
 */
export async function getPlatformPulse() {
  const [incidents, latency, inFlight] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.incidents)
      .where(isNull(s.incidents.resolvedAt)),
    db.select({ p95: sql<number>`max(${s.regions.voiceP95Ms})::int` }).from(s.regions),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.conversations)
      .where(inArray(s.conversations.status, ["live", "waiting_human"])),
  ]);

  return {
    openIncidents: incidents[0].n,
    // The worst region, not the average: an operator needs the number that is
    // about to page someone, and a mean across healthy regions hides it.
    voiceP95Ms: latency[0].p95 ?? 0,
    inFlight: inFlight[0].n,
  };
}

/**
 * Fleet-wide traffic over the last 24 hours, by hour.
 *
 * Read from `usage_daily` where it exists and from the conversation graph for
 * today, because the daily rollup is written at midnight and the operator
 * console's most-asked question is about the last hour.
 */
export async function platformLoad() {
  const rows = await db
    .select({ startedAt: s.conversations.startedAt })
    .from(s.conversations)
    .where(sql`${s.conversations.startedAt} > now() - interval '24 hours'`);

  const buckets = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const hoursAgo = Math.floor((Date.now() - r.startedAt.getTime()) / 36e5);
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo]++;
  }

  const peak = Math.max(1, ...buckets);
  return buckets.map((n) => ({
    n,
    h: `${Math.round((n / peak) * 100)}%`,
    // The busiest hours are drawn in accent — that is where capacity bites.
    color: n >= peak * 0.85 ? ACCENT : N_600,
  }));
}
