import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";

/**
 * Read models for the knowledge, tuning, team and setup screens — the parts
 * of the console that describe how the workspace itself is configured.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
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

export async function getKnowledge(brandId: string, filters: { collection?: string; q?: string } = {}) {
  const all = await db
    .select()
    .from(s.documents)
    .where(eq(s.documents.brandId, brandId))
    .orderBy(desc(s.documents.citationCount));

  // The tree counts every document; the table shows the filtered slice. Both
  // read from the same fetch, so a collection can never claim a count the
  // table cannot produce.
  let documents = all;
  if (filters.collection) documents = documents.filter((d) => d.collection === filters.collection);
  if (filters.q?.trim()) {
    const needle = filters.q.trim().toLowerCase();
    documents = documents.filter(
      (d) =>
        d.title.toLowerCase().includes(needle) ||
        d.body.toLowerCase().includes(needle) ||
        d.collection.toLowerCase().includes(needle),
    );
  }

  const [gaps, sources, chunkCounts] = await Promise.all([
    db
      .select()
      .from(s.knowledgeGaps)
      .where(eq(s.knowledgeGaps.brandId, brandId))
      .orderBy(desc(s.knowledgeGaps.hits)),
    db
      .select()
      .from(s.knowledgeSources)
      .where(eq(s.knowledgeSources.brandId, brandId))
      .orderBy(s.knowledgeSources.name),
    db
      .select({
        documentId: s.documentChunks.documentId,
        chunks: sql<number>`count(*)::int`,
        embedded: sql<number>`count(${s.documentChunks.embedding})::int`,
      })
      .from(s.documentChunks)
      .where(eq(s.documentChunks.brandId, brandId))
      .groupBy(s.documentChunks.documentId),
  ]);

  const chunksBy = new Map(chunkCounts.map((c) => [c.documentId, c]));

  // Collections are derived from the documents themselves, so adding one with
  // a new collection makes the tree grow rather than needing configuration.
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.collection, (counts.get(d.collection) ?? 0) + 1);

  const collections = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      on: filters.collection === name,
      edge: filters.collection === name ? ACCENT : "transparent",
    }));

  const stale = all.filter((d) => Date.now() - d.updatedAt.getTime() > 365 * 864e5).length;
  const missing = all.filter((d) => d.status === "missing").length;
  const embeddedTotal = chunkCounts.reduce((a, c) => a + c.embedded, 0);
  const chunkTotal = chunkCounts.reduce((a, c) => a + c.chunks, 0);
  const published = all.filter((d) => d.status === "published").length;

  /**
   * AI readiness.
   *
   * Four things stop a document being usable — never written, never indexed,
   * a year out of date, or an intent with nothing behind it at all — so the
   * score is the share of the corpus that trips none of them, not a constant.
   */
  const answerable = all.filter(
    (d) =>
      d.status === "published" &&
      (chunksBy.get(d.id)?.embedded ?? 0) > 0 &&
      Date.now() - d.updatedAt.getTime() <= 365 * 864e5,
  ).length;
  const denominator = all.length + gaps.length;
  const readinessScore = denominator > 0 ? Math.round((answerable / denominator) * 100) : 0;

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
        status: d.status,
        collection: d.collection,
        chunks: chunksBy.get(d.id)?.chunks ?? 0,
        // A document the agent cannot retrieve is worse than a missing one:
        // it looks present on this screen and is invisible to every answer.
        indexed: (chunksBy.get(d.id)?.embedded ?? 0) > 0,
      };
    }),
    total: all.length,
    collections,
    sources: sources.map((src_) => ({
      id: src_.id,
      name: src_.name,
      kind: src_.kind,
      status: src_.status,
      docCount: src_.docCount,
      error: src_.error,
      synced: src_.lastSyncedAt ? ago(src_.lastSyncedAt) : "never",
      healthy: src_.status !== "error",
    })),
    gaps: gaps.map((g) => ({
      id: g.id,
      intent: g.intent,
      hits: g.hits,
      reason: g.reason,
      draftDocumentId: g.draftDocumentId,
      lastSeen: ago(g.lastSeenAt),
    })),
    readiness: {
      score: readinessScore,
      indexed: embeddedTotal,
      chunks: chunkTotal,
      rows: [
        { label: "Documents published", value: String(published), hot: false },
        { label: "Chunks indexed for retrieval", value: `${embeddedTotal} of ${chunkTotal}`, hot: embeddedTotal < chunkTotal },
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
    /** True when edits land on a draft rather than the version answering calls. */
    editingDraft: draft !== null,
    targetId: target.id,
    toneRaw: tone,
    authority: authority.map((a) => ({
      id: a.id,
      key: a.action,
      action: a.label,
      blocked: a.blocked,
      ceilingPaise: a.ceilingPaise,
      escalateTo: a.escalateTo,
      ceiling: a.blocked
        ? "blocked"
        : a.ceilingPaise === null
          ? "unlimited"
          : formatRupees(a.ceilingPaise),
      escalate: a.escalateTo ? a.escalateTo[0].toUpperCase() + a.escalateTo.slice(1) : "—",
      color: a.blocked ? ACCENT_700 : "var(--color-text)",
    })),
    triggers: triggers.map((t) => ({ id: t.id, text: t.description, on: t.enabled })),
    neverRules: never.map((n) => ({ id: n.id, text: n.description })),
    /**
     * What publishing the draft would change.
     *
     * Diffed against the live version rather than described, because "escalates
     * earlier on Premier promises" is a release note and this is the actual
     * list of rows that differ.
     */
    diff: draft && live ? await diffVersions(live.id, draft.id) : [],
  };
}

/** Row-level differences between two agent versions. */
async function diffVersions(liveId: string, draftId: string) {
  const [liveAuth, draftAuth, liveTrig, draftTrig, liveNever, draftNever, versions] =
    await Promise.all([
      db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, liveId)),
      db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, draftId)),
      db.select().from(s.escalationTriggers).where(eq(s.escalationTriggers.agentVersionId, liveId)),
      db.select().from(s.escalationTriggers).where(eq(s.escalationTriggers.agentVersionId, draftId)),
      db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, liveId)),
      db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, draftId)),
      db.select().from(s.agentVersions).where(inArray(s.agentVersions.id, [liveId, draftId])),
    ]);

  const out: { label: string; from: string; to: string }[] = [];

  const liveVersion = versions.find((v) => v.id === liveId);
  const draftVersion = versions.find((v) => v.id === draftId);
  if (liveVersion && draftVersion) {
    if (liveVersion.persona !== draftVersion.persona) {
      out.push({ label: "Persona", from: "current wording", to: "rewritten" });
    }
    const liveTone = (liveVersion.tone ?? {}) as Record<string, number>;
    const draftTone = (draftVersion.tone ?? {}) as Record<string, number>;
    for (const key of new Set([...Object.keys(liveTone), ...Object.keys(draftTone)])) {
      if (liveTone[key] !== draftTone[key]) {
        out.push({
          label: key[0].toUpperCase() + key.slice(1),
          from: `${liveTone[key] ?? "—"}`,
          to: `${draftTone[key] ?? "—"}`,
        });
      }
    }
  }

  const describe = (a: (typeof liveAuth)[number]) =>
    a.blocked ? "blocked" : a.ceilingPaise === null ? "unlimited" : formatRupees(a.ceilingPaise);
  const liveByAction = new Map(liveAuth.map((a) => [a.action, a]));
  for (const a of draftAuth) {
    const before = liveByAction.get(a.action);
    if (!before) out.push({ label: a.label, from: "not set", to: describe(a) });
    else if (describe(before) !== describe(a)) out.push({ label: a.label, from: describe(before), to: describe(a) });
  }

  const liveTrigBy = new Map(liveTrig.map((t) => [t.description, t]));
  for (const t of draftTrig) {
    const before = liveTrigBy.get(t.description);
    if (!before) out.push({ label: t.description, from: "not a trigger", to: t.enabled ? "on" : "off" });
    else if (before.enabled !== t.enabled)
      out.push({ label: t.description, from: before.enabled ? "on" : "off", to: t.enabled ? "on" : "off" });
  }

  const liveNeverSet = new Set(liveNever.map((n) => n.description));
  const draftNeverSet = new Set(draftNever.map((n) => n.description));
  for (const n of draftNeverSet) if (!liveNeverSet.has(n)) out.push({ label: n, from: "allowed", to: "never" });
  for (const n of liveNeverSet) if (!draftNeverSet.has(n)) out.push({ label: n, from: "never", to: "allowed" });

  return out;
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
    .from(s.membershipBrands)
    .innerJoin(s.brands, eq(s.brands.id, s.membershipBrands.brandId))
    .where(eq(s.brands.orgId, orgId));

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
      const active =
        p.status === "invited"
          ? "Invited"
          : p.status === "suspended"
            ? "Suspended"
            : p.lastActiveAt && Date.now() - p.lastActiveAt.getTime() < 5 * 60_000
              ? "On call"
              : p.lastActiveAt && Date.now() - p.lastActiveAt.getTime() > 30 * 60_000
                ? "Away"
                : "Active";
      return {
        id: p.id,
        membershipId: p.id,
        name: p.name,
        email: p.email,
        /** The raw enum, for anything that needs to compare rather than print. */
        roleKey: p.role,
        role: p.role[0].toUpperCase() + p.role.slice(1),
        allBrands: p.allBrands,
        brandIds: scopeBy.get(p.id) ?? [],
        brands: p.allBrands
          ? `All ${brandRows.length} brands`
          : (scopeBy.get(p.id) ?? []).join(", ") || "None",
        status: active,
        statusKey: p.status,
        invitedByName: p.invitedByName,
        active: p.lastActiveAt ? relative(p.lastActiveAt) : "—",
        tagBg: active === "On call" ? ACCENT_200 : active === "Invited" ? ACCENT_200 : N_200,
        tagFg: active === "On call" ? ACCENT_800 : active === "Invited" ? ACCENT_800 : N_800,
      };
    }),
    brands: brandRows.map((b) => ({ id: b.id, name: b.name })),
    brandAccess: brandRows.map((b) => ({
      name: b.name,
      people: `${people.filter((p) => p.allBrands || (scopeBy.get(p.id) ?? []).includes(b.name)).length} people`,
    })),
    activity: activity.map((a) => ({
      id: a.id,
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

export async function getSetup(orgId: string, brandId?: string) {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId)).limit(1);
  const brandRows = await db.select().from(s.brands).where(eq(s.brands.orgId, orgId));
  const integrations = await db
    .select()
    .from(s.integrations)
    .where(eq(s.integrations.orgId, orgId))
    .orderBy(s.integrations.name);

  // Channels and hours belong to a brand, so they follow the brand switcher
  // rather than always describing whichever brand happens to sort first.
  const current = brandRows.find((b) => b.id === brandId) ?? brandRows[0];

  const [channelRows, hourRows, privacyRows, auditRows] = await Promise.all([
    current
      ? db.select().from(s.channels).where(eq(s.channels.brandId, current.id))
      : Promise.resolve([]),
    current
      ? db
          .select()
          .from(s.businessHours)
          .where(eq(s.businessHours.brandId, current.id))
          .orderBy(s.businessHours.weekday)
      : Promise.resolve([]),
    db.select().from(s.privacySettings).where(eq(s.privacySettings.orgId, orgId)).limit(1),
    db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.orgId, orgId))
      .orderBy(desc(s.auditLog.at))
      .limit(40),
  ]);

  const customerCounts = await db
    .select({ brandId: s.customers.brandId, n: sql<number>`count(*)::int` })
    .from(s.customers)
    .groupBy(s.customers.brandId);
  const countBy = new Map(customerCounts.map((c) => [c.brandId, c.n]));

  const conversationCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    // Rehearsals do not eat a tenant's plan allowance.
    .where(and(eq(s.brands.orgId, orgId), eq(s.conversations.isTest, false)));

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  const privacy = privacyRows[0] ?? null;

  return {
    org,
    brand: current ?? null,
    brands: brandRows.map((b) => ({
      id: b.id,
      slug: b.slug,
      isLive: b.isLive,
      agentName: b.agentName,
      timezone: b.timezone,
      afterHoursMode: b.afterHoursMode,
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
    hours: hourRows.map((h) => ({
      weekday: h.weekday,
      day: DAYS[h.weekday],
      closed: h.closed,
      opens: h.opensMinute,
      closes: h.closesMinute,
      label: h.closed ? "Closed" : `${hhmm(h.opensMinute)} – ${hhmm(h.closesMinute)}`,
    })),
    /** What happens outside those hours, in the brand's own words. */
    afterHours:
      current?.afterHoursMode === "voicemail"
        ? "Voicemail, transcribed and queued"
        : current?.afterHoursMode === "closed"
          ? "Closed — callers hear the closing message"
          : "The AI answers, and escalations wait for morning",
    privacy: privacy
      ? {
          retentionDays: privacy.retentionDays,
          redactPii: privacy.redactPii,
          trainOnTranscripts: privacy.trainOnTranscripts,
          recordCalls: privacy.recordCalls,
          dataRegion: privacy.dataRegion,
          dpoEmail: privacy.dpoEmail,
          allowSupportAccess: privacy.allowSupportAccess,
          updatedBy: privacy.updatedByName,
          updatedAt: privacy.updatedAt,
        }
      : null,
    audit: auditRows.map((a) => ({
      id: a.id,
      who: a.actorName ?? "Someone",
      actorType: a.actorType,
      action: a.action.replace(/[._]/g, " "),
      target: a.target,
      when: relative(a.at),
      at: a.at,
    })),
    channels: channelRows.map((c) => ({
      id: c.id,
      kind: c.kind,
      state: c.state,
      name: c.kind === "web_chat" ? "Web chat" : c.kind[0].toUpperCase() + c.kind.slice(1),
      detail: c.detail ?? c.address ?? "Not connected",
      status: c.state === "live" ? "Live" : c.state === "drafts_only" ? "AI drafts only" : "Not connected",
      live: c.state === "live",
      connected: c.state !== "not_connected",
    })),
    integrations: integrations.map((g) => ({
      id: g.id,
      name: g.name,
      purpose: g.purpose ?? "",
      status: g.status,
      healthy: g.healthy,
      color: g.healthy ? N_800 : ACCENT_700,
    })),
    usage: {
      conversations: conversationCount[0].n,
      // Plan allowance, so the usage bar means something.
      allowance: org?.plan === "enterprise" ? 100_000 : org?.plan === "operator" ? 25_000 : 5_000,
    },
  };
}


/* ─── Demo profiles ────────────────────────────────────────────────────── */

/**
 * The people the demo console can be looked at as.
 *
 * Sorted by role seniority rather than alphabetically, because the point of
 * the list is to make the *shape* of the workspace legible at a glance — an
 * Owner, a couple of Managers, the Agents under them — and a list ordered by
 * first name hides exactly that.
 */
export async function switchableProfiles(orgId: string) {
  const rows = await db
    .select({
      id: s.memberships.id,
      name: s.memberships.name,
      role: s.memberships.role,
      availability: s.memberships.availability,
      rating: s.memberships.rating,
    })
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active")))
    .orderBy(s.memberships.name);

  const rank: Record<string, number> = { owner: 0, admin: 1, manager: 2, agent: 3, analyst: 4 };
  return rows.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));
}
