import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "@/lib/business/industries";
import { formatPhone } from "@/lib/business/phone";
import { resolveModel } from "@/lib/agent/models";

/**
 * Reads for Corva's own console.
 *
 * Staff see every business: whether it can take a call, what number it answers
 * on, and whether calls are turning into leads. They do not see transcripts
 * from here — the business's own console is where those live, and in demo mode
 * "open their console" is one click away.
 */

const WEEK = sql`now() - interval '7 days'`;

/** Every business, newest first, with the numbers that say whether it is working. */
export async function listBusinesses() {
  const rows = await db
    .select({
      org: s.organizations,
      brand: s.brands,
      phone: sql<string | null>`(
        select c.address from ${s.channels} c where c.brand_id = brands.id and c.kind = 'phone' limit 1
      )`,
      people: sql<number>`(
        select count(*)::int from ${s.memberships} m where m.org_id = organizations.id and m.status = 'active'
      )`,
      docs: sql<number>`(
        select count(*)::int from ${s.documents} d where d.brand_id = brands.id and d.status = 'published'
      )`,
      hasAgent: sql<boolean>`exists (
        select 1 from ${s.agentVersions} v where v.brand_id = brands.id and v.status = 'live'
      )`,
      conversations7d: sql<number>`(
        select count(*)::int from ${s.conversations} cv where cv.brand_id = brands.id and cv.started_at > ${WEEK}
      )`,
      live: sql<number>`(
        select count(*)::int from ${s.conversations} cv where cv.brand_id = brands.id and cv.status in ('live', 'waiting_human')
      )`,
      leads7d: sql<number>`(
        select count(*)::int from ${s.leads} l where l.brand_id = brands.id and l.created_at > ${WEEK}
      )`,
      openFollowUps: sql<number>`(
        select count(*)::int from ${s.followUps} f where f.brand_id = brands.id and f.status = 'open'
      )`,
    })
    .from(s.organizations)
    .leftJoin(s.brands, eq(s.brands.orgId, s.organizations.id))
    .orderBy(desc(s.organizations.createdAt), s.brands.createdAt);

  return rows.map((r) => ({
    orgSlug: r.org.slug,
    orgName: r.org.name,
    createdAt: r.org.createdAt,
    brandId: r.brand?.id ?? null,
    brandName: r.brand?.name ?? null,
    industry: industryFor(r.brand?.industry).label,
    agentName: r.brand?.agentName ?? null,
    model: r.brand ? resolveModel(r.brand.modelId).label : null,
    phone: r.phone ? formatPhone(r.phone) : null,
    people: r.people,
    docs: r.docs,
    canAnswer: Boolean(r.hasAgent && r.phone),
    conversations7d: r.conversations7d,
    live: r.live,
    leads7d: r.leads7d,
    openFollowUps: r.openFollowUps,
  }));
}

export type BusinessRow = Awaited<ReturnType<typeof listBusinesses>>[number];

/** The header strip: how much is happening across every business right now. */
export async function getPlatformPulse() {
  const [row] = await db
    .select({
      businesses: sql<number>`(select count(*)::int from ${s.organizations})`,
      live: sql<number>`(select count(*)::int from ${s.conversations} where status in ('live', 'waiting_human'))`,
      leadsToday: sql<number>`(select count(*)::int from ${s.leads} where created_at > now() - interval '24 hours')`,
    })
    .from(sql`(select 1) as one`);
  return row;
}

/** One business, for its detail page. */
export async function getBusiness(slug: string) {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, slug)).limit(1);
  if (!org) return null;

  const brands = await db.select().from(s.brands).where(eq(s.brands.orgId, org.id)).orderBy(s.brands.createdAt);
  const brandIds = brands.map((b) => b.id);

  const [people, channels, docs, recent, staffAudit] = await Promise.all([
    db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.orgId, org.id))
      .orderBy(sql`array_position(array['owner','admin','manager','agent','analyst']::text[], ${s.memberships.role}::text)`),
    brandIds.length ? db.select().from(s.channels).where(inArray(s.channels.brandId, brandIds)) : [],
    brandIds.length
      ? db
          .select({ id: s.documents.id, brandId: s.documents.brandId, title: s.documents.title, status: s.documents.status, source: s.documents.sourceSystem })
          .from(s.documents)
          .where(inArray(s.documents.brandId, brandIds))
          .orderBy(desc(s.documents.updatedAt))
      : [],
    brandIds.length
      ? db
          .select({ c: s.conversations, customer: s.customers.name })
          .from(s.conversations)
          .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
          .where(inArray(s.conversations.brandId, brandIds))
          .orderBy(desc(s.conversations.startedAt))
          .limit(8)
      : [],
    db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.orgId, org.id), eq(s.auditLog.actorType, "staff")))
      .orderBy(desc(s.auditLog.at))
      .limit(6),
  ]);

  return {
    org,
    brands: brands.map((b) => ({
      ...b,
      industryLabel: industryFor(b.industry).label,
      phone: channels.find((c) => c.brandId === b.id && c.kind === "phone")?.address ?? null,
      docs: docs.filter((d) => d.brandId === b.id),
    })),
    people,
    recent: recent.map((r) => ({
      id: r.c.id,
      customer: r.customer ?? "Unknown caller",
      channel: r.c.channel,
      status: r.c.status,
      summary: r.c.summary ?? r.c.liveSummary ?? r.c.intent ?? null,
      startedAt: r.c.startedAt,
      isTest: r.c.isTest,
    })),
    staffActivity: staffAudit,
  };
}
