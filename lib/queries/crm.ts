import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { LEAD_STAGES, OPEN_STAGES, industryFor, normaliseStage } from "@/lib/business/industries";

/**
 * Reads for the CRM screens: leads, follow-ups, and who on the team can own
 * them. Scoping follows the customers rule — an Agent sees what is theirs, a
 * Manager sees the business — and is passed in rather than inferred here, so
 * the screen that decided it is the one accountable for it.
 */

export type Scope = { kind: "all" } | { kind: "own"; membershipId: string };

const owner = alias(s.memberships, "owner");

/** Everyone who can be handed a lead or a follow-up. */
export async function assignableMembers(orgId: string) {
  const rows = await db
    .select({ id: s.memberships.id, name: s.memberships.name, role: s.memberships.role })
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active")))
    .orderBy(asc(s.memberships.name));
  return rows.filter((r) => r.role !== "analyst");
}

export async function listLeads(brandId: string, scope: Scope, opts: { q?: string; customerId?: string } = {}) {
  const q = opts.q?.trim();
  const rows = await db
    .select({
      lead: s.leads,
      ownerName: owner.name,
      customerName: s.customers.name,
      nextDue: sql<Date | null>`(
        select min(f.due_at) from ${s.followUps} f
        where f.lead_id = leads.id and f.status = 'open'
      )`,
      openFollowUps: sql<number>`(
        select count(*)::int from ${s.followUps} f
        where f.lead_id = leads.id and f.status = 'open'
      )`,
    })
    .from(s.leads)
    .leftJoin(owner, eq(owner.id, s.leads.ownerMembershipId))
    .leftJoin(s.customers, eq(s.customers.id, s.leads.customerId))
    .where(
      and(
        eq(s.leads.brandId, brandId),
        scope.kind === "own" ? eq(s.leads.ownerMembershipId, scope.membershipId) : undefined,
        opts.customerId ? eq(s.leads.customerId, opts.customerId) : undefined,
        q
          ? or(
              sql`${s.leads.name} ilike ${`%${q}%`}`,
              sql`${s.leads.interest} ilike ${`%${q}%`}`,
              sql`coalesce(${s.leads.phone}, '') ilike ${`%${q}%`}`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(s.leads.updatedAt))
    .limit(500);

  return rows.map((r) => ({
    ...r.lead,
    ownerName: r.ownerName,
    customerName: r.customerName,
    nextDue: r.nextDue ? new Date(r.nextDue) : null,
    openFollowUps: r.openFollowUps,
  }));
}

export type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];

/** Counts and value per stage, with the industry's words for each. */
export function pipeline(leads: LeadRow[], industryKey: string) {
  const industry = industryFor(industryKey);
  return LEAD_STAGES.map((stage) => {
    const inStage = leads.filter((l) => normaliseStage(l.stage) === stage);
    return {
      stage,
      label: industry.stages[stage],
      count: inStage.length,
      valuePaise: inStage.reduce((sum, l) => sum + (l.valuePaise ?? 0), 0),
      leads: inStage,
    };
  });
}

export type FollowUpWindow = "overdue" | "today" | "upcoming" | "done";

/** Start and end of today in India, as instants. */
export function todayInIndia(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
  return { start, end: new Date(start.getTime() + 864e5) };
}

export async function listFollowUps(
  brandId: string,
  scope: Scope,
  opts: { window?: FollowUpWindow; customerId?: string; leadId?: string; limit?: number } = {},
) {
  // Overdue means past its time, not "from before today": a 4pm callback not
  // made by 6pm is late now, and every screen has to agree on that.
  const { end } = todayInIndia();
  const now = new Date();
  const window = opts.window;
  const windowWhere =
    window === "overdue"
      ? and(eq(s.followUps.status, "open"), lt(s.followUps.dueAt, now))
      : window === "today"
        ? and(eq(s.followUps.status, "open"), gte(s.followUps.dueAt, now), lt(s.followUps.dueAt, end))
        : window === "upcoming"
          ? and(eq(s.followUps.status, "open"), gte(s.followUps.dueAt, end))
          : window === "done"
            ? inArray(s.followUps.status, ["done", "cancelled"])
            : undefined;

  const rows = await db
    .select({
      followUp: s.followUps,
      assigneeName: owner.name,
      customerName: s.customers.name,
      customerPhone: s.customers.phone,
      leadName: s.leads.name,
      leadInterest: s.leads.interest,
    })
    .from(s.followUps)
    .leftJoin(owner, eq(owner.id, s.followUps.assigneeMembershipId))
    .leftJoin(s.customers, eq(s.customers.id, s.followUps.customerId))
    .leftJoin(s.leads, eq(s.leads.id, s.followUps.leadId))
    .where(
      and(
        eq(s.followUps.brandId, brandId),
        scope.kind === "own"
          ? or(
              eq(s.followUps.assigneeMembershipId, scope.membershipId),
              isNull(s.followUps.assigneeMembershipId),
            )
          : undefined,
        opts.customerId ? eq(s.followUps.customerId, opts.customerId) : undefined,
        opts.leadId ? eq(s.followUps.leadId, opts.leadId) : undefined,
        windowWhere,
      ),
    )
    .orderBy(window === "done" ? desc(s.followUps.completedAt) : asc(s.followUps.dueAt))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    ...r.followUp,
    assigneeName: r.assigneeName,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    leadName: r.leadName,
    leadInterest: r.leadInterest,
    overdue: r.followUp.status === "open" && r.followUp.dueAt < now,
  }));
}

export type FollowUpRow = Awaited<ReturnType<typeof listFollowUps>>[number];

/** How many follow-ups sit in each window, for the tab counts. */
export async function followUpCounts(brandId: string, scope: Scope) {
  const { end } = todayInIndia();
  const now = new Date();
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${s.followUps.status} = 'open' and ${s.followUps.dueAt} < ${now})::int`,
      today: sql<number>`count(*) filter (where ${s.followUps.status} = 'open' and ${s.followUps.dueAt} >= ${now} and ${s.followUps.dueAt} < ${end})::int`,
      upcoming: sql<number>`count(*) filter (where ${s.followUps.status} = 'open' and ${s.followUps.dueAt} >= ${end})::int`,
      done: sql<number>`count(*) filter (where ${s.followUps.status} <> 'open')::int`,
    })
    .from(s.followUps)
    .where(
      and(
        eq(s.followUps.brandId, brandId),
        scope.kind === "own"
          ? or(eq(s.followUps.assigneeMembershipId, scope.membershipId), isNull(s.followUps.assigneeMembershipId))
          : undefined,
      ),
    );
  return row ?? { overdue: 0, today: 0, upcoming: 0, done: 0 };
}

/** The CRM figures the home screen leads with. */
export async function crmSnapshot(brandId: string, scope: Scope) {
  const since = new Date(Date.now() - 7 * 864e5);
  const ownWhere = scope.kind === "own" ? eq(s.leads.ownerMembershipId, scope.membershipId) : undefined;
  const [leadRow] = await db
    .select({
      open: sql<number>`count(*) filter (where ${inArray(s.leads.stage, OPEN_STAGES)})::int`,
      newThisWeek: sql<number>`count(*) filter (where ${s.leads.createdAt} >= ${since})::int`,
      byAi: sql<number>`count(*) filter (where ${s.leads.createdAt} >= ${since} and ${s.leads.createdByAi})::int`,
      wonThisWeek: sql<number>`count(*) filter (where ${s.leads.stage} = 'won' and ${s.leads.stageChangedAt} >= ${since})::int`,
      pipelinePaise: sql<number>`coalesce(sum(${s.leads.valuePaise}) filter (where ${inArray(s.leads.stage, OPEN_STAGES)}), 0)::bigint`,
    })
    .from(s.leads)
    .where(and(eq(s.leads.brandId, brandId), ownWhere));
  const counts = await followUpCounts(brandId, scope);
  return {
    openLeads: leadRow?.open ?? 0,
    newLeadsThisWeek: leadRow?.newThisWeek ?? 0,
    leadsByAiThisWeek: leadRow?.byAi ?? 0,
    wonThisWeek: leadRow?.wonThisWeek ?? 0,
    pipelinePaise: Number(leadRow?.pipelinePaise ?? 0),
    followUps: counts,
  };
}

/** What the AI (or a person) recorded during one conversation. */
export async function capturedOn(conversationId: string) {
  const [leads, followUps] = await Promise.all([
    db
      .select({ lead: s.leads, ownerName: owner.name })
      .from(s.leads)
      .leftJoin(owner, eq(owner.id, s.leads.ownerMembershipId))
      .where(eq(s.leads.conversationId, conversationId)),
    db
      .select({ followUp: s.followUps, assigneeName: owner.name })
      .from(s.followUps)
      .leftJoin(owner, eq(owner.id, s.followUps.assigneeMembershipId))
      .where(eq(s.followUps.conversationId, conversationId))
      .orderBy(asc(s.followUps.createdAt)),
  ]);
  return {
    leads: leads.map((r) => ({ ...r.lead, ownerName: r.ownerName })),
    followUps: followUps.map((r) => ({ ...r.followUp, assigneeName: r.assigneeName })),
  };
}

/** What a customer did on the business's website, if they came from it. */
export async function websiteActivity(customerId: string) {
  const visitors = await db
    .select()
    .from(s.visitors)
    .where(eq(s.visitors.customerId, customerId))
    .orderBy(asc(s.visitors.firstSeenAt));
  if (visitors.length === 0) return null;
  const events = await db
    .select()
    .from(s.visitorEvents)
    .where(inArray(s.visitorEvents.visitorId, visitors.map((v) => v.id)))
    .orderBy(desc(s.visitorEvents.at))
    .limit(12);
  const first = visitors[0];
  const utm = (first.firstUtm ?? {}) as Record<string, string>;
  let referrer: string | null = null;
  try {
    referrer = first.firstReferrer ? new URL(first.firstReferrer).hostname.replace(/^www\./, "") : null;
  } catch {
    referrer = first.firstReferrer;
  }
  return {
    firstSeen: first.firstSeenAt,
    lastSeen: visitors.reduce((d, v) => (v.lastSeenAt > d ? v.lastSeenAt : d), first.lastSeenAt),
    pageViews: visitors.reduce((n, v) => n + v.pageViews, 0),
    consentedAnalytics: visitors.some((v) => v.consent === "all"),
    source: utm.utm_source ?? referrer ?? null,
    campaign: utm.utm_campaign ?? null,
    events: events.map((e) => ({ id: e.id, type: e.type, path: e.path, at: e.at })),
  };
}
