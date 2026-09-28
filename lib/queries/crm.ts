import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { LEAD_STAGES, OPEN_STAGES, industryFor, type LeadStage } from "@/lib/business/industries";

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

export async function listLeads(brandId: string, scope: Scope, opts: { q?: string } = {}) {
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
    const inStage = leads.filter((l) => l.stage === stage);
    return {
      stage,
      label: industry.stages[stage],
      count: inStage.length,
      valuePaise: inStage.reduce((sum, l) => sum + (l.valuePaise ?? 0), 0),
      leads: inStage,
    };
  });
}

export async function getLead(brandId: string, leadId: string) {
  const [row] = await db
    .select({ lead: s.leads, ownerName: owner.name })
    .from(s.leads)
    .leftJoin(owner, eq(owner.id, s.leads.ownerMembershipId))
    .where(and(eq(s.leads.id, leadId), eq(s.leads.brandId, brandId)))
    .limit(1);
  return row ? { ...row.lead, ownerName: row.ownerName } : null;
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
  const { start, end } = todayInIndia();
  const window = opts.window;
  const windowWhere =
    window === "overdue"
      ? and(eq(s.followUps.status, "open"), lt(s.followUps.dueAt, start))
      : window === "today"
        ? and(eq(s.followUps.status, "open"), gte(s.followUps.dueAt, start), lt(s.followUps.dueAt, end))
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
    overdue: r.followUp.status === "open" && r.followUp.dueAt < start,
  }));
}

export type FollowUpRow = Awaited<ReturnType<typeof listFollowUps>>[number];

/** How many follow-ups sit in each window, for the tab counts. */
export async function followUpCounts(brandId: string, scope: Scope) {
  const { start, end } = todayInIndia();
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${s.followUps.status} = 'open' and ${s.followUps.dueAt} < ${start})::int`,
      today: sql<number>`count(*) filter (where ${s.followUps.status} = 'open' and ${s.followUps.dueAt} >= ${start} and ${s.followUps.dueAt} < ${end})::int`,
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

export const isOpenStage = (stage: LeadStage) => OPEN_STAGES.includes(stage);
