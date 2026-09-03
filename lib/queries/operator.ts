import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
const ACCENT_800 = "var(--color-accent-800)";
const BG = "var(--color-bg)";
const N_300 = "var(--color-neutral-300)";
const N_500 = "var(--color-neutral-500)";
const N_800 = "var(--color-neutral-800)";

const money = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/* ─── Fleet ────────────────────────────────────────────────────────────── */

export async function getFleet() {
  const orgs = await db.select().from(s.organizations).orderBy(s.organizations.healthScore);

  const brandCounts = await db
    .select({ orgId: s.brands.orgId, n: sql<number>`count(*)::int` })
    .from(s.brands)
    .groupBy(s.brands.orgId);
  const brandsBy = new Map(brandCounts.map((b) => [b.orgId, b.n]));

  // Conversation volume and containment, per tenant, in one pass.
  const convStats = await db
    .select({
      orgId: s.brands.orgId,
      total: sql<number>`count(*)::int`,
      contained: sql<number>`count(*) FILTER (WHERE ${s.conversations.contained})::int`,
    })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .groupBy(s.brands.orgId);
  const statsBy = new Map(convStats.map((c) => [c.orgId, c]));

  const tenants = orgs.map((o) => {
    const health = o.healthScore ?? 0;
    const stats = statsBy.get(o.id);
    const containment = stats && stats.total > 0 ? (stats.contained / stats.total) * 100 : null;
    const bad = health < operatorConfig.healthThreshold;

    return {
      slug: o.slug,
      name: o.name,
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

  const mrrTotal = orgs.reduce((a, o) => a + o.mrrPence, 0);
  const atRisk = orgs
    .filter((o) => (o.healthScore ?? 100) < operatorConfig.healthThreshold)
    .reduce((a, o) => a + o.mrrPence, 0);
  const allConv = convStats.reduce((a, c) => a + c.total, 0);
  const allContained = convStats.reduce((a, c) => a + c.contained, 0);

  return {
    tenants,
    kpis: [
      { label: "Companies", value: String(orgs.length), delta: "", note: "on Corva", good: true },
      { label: "MRR", value: money(mrrTotal), delta: "", note: "across the fleet", good: true },
      {
        label: "Conversations",
        value: allConv.toLocaleString("en-GB"),
        delta: "",
        note: "all tenants",
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
        value: String(tenants.filter((t) => t.bad).length),
        delta: "",
        note: `under ${operatorConfig.healthThreshold}`,
        good: false,
      },
      { label: "At-risk MRR", value: money(atRisk), delta: "", note: "unhealthy tenants", good: false },
    ].map((k) => ({ ...k, deltaColor: k.good ? ACCENT_400 : ACCENT })),
    needsAttention: tenants
      .filter((t) => t.bad)
      .slice(0, 4)
      .map((t) => ({
        name: t.name,
        note: `Health ${t.healthV}, containment ${t.containment}. ${t.plan} plan.`,
        urgent: t.healthV < 50,
      })),
  };
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

  const notes = await db
    .select()
    .from(s.auditLog)
    .where(eq(s.auditLog.orgId, org.id))
    .orderBy(desc(s.auditLog.at))
    .limit(4);

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
        name: flag.label,
        note: flag.note ?? "",
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
      when: n.at.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      note: `${n.actorName ?? "Someone"} · ${n.action.replace(/[._]/g, " ")}`,
    })),
  };
}

/* ─── Cross-tenant quality ─────────────────────────────────────────────── */

export async function getFleetQuality() {
  const flagged = await db
    .select({ flag: s.qualityFlags, org: s.organizations })
    .from(s.qualityFlags)
    .innerJoin(s.organizations, eq(s.organizations.id, s.qualityFlags.orgId))
    .orderBy(desc(s.qualityFlags.createdAt))
    .limit(20);

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
        note: "all tenants",
      },
      { label: "Citation rate", value: `${citationRate.toFixed(1)}%`, note: "target 97%" },
      { label: "AI turns", value: aiTurns.n.toLocaleString("en-GB"), note: "recorded" },
      { label: "Documentation gaps", value: String(gapCount.n), note: "across the fleet" },
      { label: "Flagged turns", value: String(flagged.length), note: "awaiting review" },
    ],
    flagged: flagged.map((f) => ({
      company: f.org.name,
      klass: f.flag.failureClass.replace(/_/g, " "),
      turns: "1",
      cause: f.flag.rootCause ?? "—",
      owner: f.flag.owner === "tenant" ? "Tenant" : "Fleet eval",
      color: f.flag.owner === "tenant" ? N_300 : ACCENT_400,
    })),
  };
}

/* ─── Revenue ──────────────────────────────────────────────────────────── */

export async function getFleetRevenue() {
  const orgs = await db.select().from(s.organizations);
  const mrr = orgs.reduce((a, o) => a + o.mrrPence, 0);

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
  };
}

/** Open support grants, so the console can show what staff currently reach. */
export async function activeGrants() {
  return db
    .select({ grant: s.supportGrants, org: s.organizations, staff: s.staff })
    .from(s.supportGrants)
    .innerJoin(s.organizations, eq(s.organizations.id, s.supportGrants.orgId))
    .innerJoin(s.staff, eq(s.staff.id, s.supportGrants.staffId))
    .where(and(isNull(s.supportGrants.revokedAt), sql`${s.supportGrants.expiresAt} > now()`));
}
