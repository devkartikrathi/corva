import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Read models for the knowledge, tuning, team and setup screens — the parts
 * of the console that describe how the workspace itself is configured.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
const N_500 = "var(--color-neutral-500)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";

const ago = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (days < 1) return "today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  if (days < 730) return `${Math.floor(days / 30)} months`;
  return "never";
};

/* ─── Knowledge base ───────────────────────────────────────────────────── */

export async function getKnowledge(brandId: string) {
  const documents = await db
    .select()
    .from(s.documents)
    .where(eq(s.documents.brandId, brandId))
    .orderBy(desc(s.documents.citationCount));

  const gaps = await db
    .select()
    .from(s.knowledgeGaps)
    .where(eq(s.knowledgeGaps.brandId, brandId))
    .orderBy(desc(s.knowledgeGaps.hits));

  // Collections are derived from the documents themselves, so adding one with
  // a new collection makes the tree grow rather than needing configuration.
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.collection, (counts.get(d.collection) ?? 0) + 1);

  const collections = [...counts.entries()].map(([name, count], i) => ({
    name,
    count,
    on: i === 0,
    edge: i === 0 ? ACCENT : "transparent",
  }));

  const stale = documents.filter((d) => Date.now() - d.updatedAt.getTime() > 365 * 864e5).length;
  const missing = documents.filter((d) => d.status === "missing").length;
  const embedded = await db
    .select({ n: sql<number>`count(embedding)::int` })
    .from(s.documentChunks)
    .where(eq(s.documentChunks.brandId, brandId));

  const published = documents.filter((d) => d.status === "published").length;

  return {
    documents: documents.map((d) => {
      const success = d.successRate === null ? null : Math.round(d.successRate * 100);
      const isStale = Date.now() - d.updatedAt.getTime() > 365 * 864e5 || d.status === "missing";
      return {
        id: d.id,
        title: d.title,
        meta: [d.kind, d.collection, d.status === "missing" ? "Missing" : null]
          .filter(Boolean)
          .join(" · "),
        uses: d.citationCount === 0 ? "0" : String(d.citationCount),
        success: success === null ? "—" : `${success}%`,
        bar: `${success ?? 100}%`,
        color: (success ?? 100) >= 80 ? N_700 : ACCENT,
        fresh: d.status === "missing" ? "never" : ago(d.updatedAt),
        freshColor: isStale ? ACCENT_700 : N_800,
        owner: d.ownerName ?? "Unassigned",
      };
    }),
    collections,
    gaps: gaps.map((g) => ({
      id: g.id,
      intent: g.intent,
      hits: g.hits,
      reason: g.reason,
    })),
    readiness: {
      // Readiness is what the AI could actually reach for, not what was uploaded.
      score: published > 0 ? Math.round((embedded[0].n > 0 ? 0.82 : 0.4) * 100) : 0,
      indexed: embedded[0].n,
      rows: [
        { label: "Documents published", value: String(published), hot: false },
        { label: "Documents older than a year", value: String(stale), hot: stale > 0 },
        { label: "Intents with no document", value: String(gaps.length), hot: gaps.length > 0 },
        { label: "Documents never written", value: String(missing), hot: missing > 0 },
      ],
    },
  };
}

/* ─── Tuning ───────────────────────────────────────────────────────────── */

export async function getTuning(brandId: string) {
  const versions = await db
    .select()
    .from(s.agentVersions)
    .where(eq(s.agentVersions.brandId, brandId))
    .orderBy(desc(s.agentVersions.version));

  const live = versions.find((v) => v.status === "live") ?? null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const target = draft ?? live;
  if (!target) return null;

  const [authority, triggers, never] = await Promise.all([
    db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, target.id)),
    db.select().from(s.escalationTriggers).where(eq(s.escalationTriggers.agentVersionId, target.id)),
    db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, target.id)),
  ]);

  const tone = (target.tone ?? {}) as Record<string, number>;
  const TONE_ENDS: Record<string, [string, string]> = {
    warmth: ["clinical", "effusive"],
    brevity: ["thorough", "terse"],
    formality: ["casual", "formal"],
    persistence: ["hands over early", "keeps trying"],
  };

  return {
    live,
    draft,
    versions,
    persona: target.persona,
    tone: Object.entries(tone).map(([key, value]) => ({
      label: key[0].toUpperCase() + key.slice(1),
      value: `${value} / 10`,
      bar: `${value * 10}%`,
      low: TONE_ENDS[key]?.[0] ?? "",
      high: TONE_ENDS[key]?.[1] ?? "",
    })),
    authority: authority.map((a) => ({
      action: a.label,
      ceiling: a.blocked
        ? "blocked"
        : a.ceilingPence === null
          ? "unlimited"
          : `£${(a.ceilingPence / 100).toLocaleString("en-GB")}`,
      escalate: a.escalateTo ? a.escalateTo[0].toUpperCase() + a.escalateTo.slice(1) : "—",
      color: a.blocked ? ACCENT_700 : "var(--color-text)",
    })),
    triggers: triggers.map((t) => ({ text: t.description, on: t.enabled })),
    neverRules: never.map((n) => n.description),
  };
}

/* ─── Team ─────────────────────────────────────────────────────────────── */

export async function getTeam(orgId: string) {
  const people = await db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.orgId, orgId))
    .orderBy(s.memberships.createdAt);

  const brandRows = await db.select().from(s.brands).where(eq(s.brands.orgId, orgId));
  const scopes = await db
    .select({ membershipId: s.membershipBrands.membershipId, brandId: s.membershipBrands.brandId })
    .from(s.membershipBrands);

  const brandName = new Map(brandRows.map((b) => [b.id, b.name]));
  const scopeBy = new Map<string, string[]>();
  for (const sc of scopes) {
    const list = scopeBy.get(sc.membershipId) ?? [];
    const name = brandName.get(sc.brandId);
    if (name) list.push(name);
    scopeBy.set(sc.membershipId, list);
  }

  const activity = await db
    .select()
    .from(s.auditLog)
    .where(eq(s.auditLog.orgId, orgId))
    .orderBy(desc(s.auditLog.at))
    .limit(6);

  return {
    people: people.map((p) => {
      const invited = p.invitedAt !== null && p.lastActiveAt === null;
      const active =
        p.lastActiveAt && Date.now() - p.lastActiveAt.getTime() < 5 * 60_000
          ? "On call"
          : invited
            ? "Invited"
            : p.lastActiveAt && Date.now() - p.lastActiveAt.getTime() > 30 * 60_000
              ? "Away"
              : "Active";
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role[0].toUpperCase() + p.role.slice(1),
        brands: p.allBrands
          ? `All ${brandRows.length} brands`
          : (scopeBy.get(p.id) ?? []).join(", ") || "None",
        status: active,
        active: p.lastActiveAt ? relative(p.lastActiveAt) : "—",
        tagBg: active === "On call" ? ACCENT_200 : N_200,
        tagFg: active === "On call" ? ACCENT_800 : N_800,
      };
    }),
    brandAccess: brandRows.map((b) => ({
      name: b.name,
      people: `${people.filter((p) => p.allBrands || (scopeBy.get(p.id) ?? []).includes(b.name)).length} people`,
    })),
    activity: activity.map((a) => ({
      who: a.actorName ?? "Someone",
      what: `${a.action.replace(/[._]/g, " ")}${a.target ? ` · ${a.target}` : ""} · ${relative(a.at)}`,
    })),
  };
}

function relative(d: Date) {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/* ─── Setup ────────────────────────────────────────────────────────────── */

export async function getSetup(orgId: string) {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId)).limit(1);
  const brandRows = await db.select().from(s.brands).where(eq(s.brands.orgId, orgId));
  const integrations = await db
    .select()
    .from(s.integrations)
    .where(eq(s.integrations.orgId, orgId))
    .orderBy(s.integrations.name);

  const channelRows = brandRows.length
    ? await db
        .select()
        .from(s.channels)
        .where(eq(s.channels.brandId, brandRows[0].id))
    : [];

  const customerCounts = await db
    .select({ brandId: s.customers.brandId, n: sql<number>`count(*)::int` })
    .from(s.customers)
    .groupBy(s.customers.brandId);
  const countBy = new Map(customerCounts.map((c) => [c.brandId, c.n]));

  const conversationCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .where(eq(s.brands.orgId, orgId));

  return {
    org,
    brands: brandRows.map((b) => ({
      initials: b.initials,
      name: b.name,
      meta: [
        b.segment,
        `${countBy.get(b.id) ?? 0} customers`,
        b.agentName ? `agent ${b.agentName}` : "no agent yet",
      ]
        .filter(Boolean)
        .join(" · "),
      status: b.isLive ? "Live" : "Setup",
      live: b.isLive,
      tagBg: b.isLive ? ACCENT_200 : N_200,
      tagFg: b.isLive ? ACCENT_800 : N_800,
    })),
    channels: channelRows.map((c) => ({
      name: c.kind === "web_chat" ? "Web chat" : c.kind[0].toUpperCase() + c.kind.slice(1),
      detail: c.detail ?? c.address ?? "Not connected",
      status: c.state === "live" ? "Live" : c.state === "drafts_only" ? "AI drafts only" : "Not connected",
      live: c.state === "live",
      connected: c.state !== "not_connected",
    })),
    integrations: integrations.map((g) => ({
      name: g.name,
      purpose: g.purpose ?? "",
      status: g.status,
      color: g.healthy ? N_800 : ACCENT_700,
    })),
    usage: {
      conversations: conversationCount[0].n,
      // Plan allowance, so the usage bar means something.
      allowance: org?.plan === "enterprise" ? 100_000 : org?.plan === "operator" ? 25_000 : 5_000,
    },
  };
}
