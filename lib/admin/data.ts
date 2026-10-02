import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "@/lib/business/industries";
import { accountState } from "@/lib/billing/usage";

/** Every business, with what Corva needs to know to look after it: plan, usage, activity. */
export async function listAccounts() {
  const orgs = await db
    .select({
      org: s.organizations,
      owner: sql<string | null>`(select m.email from ${s.memberships} m where m.org_id = organizations.id and m.role = 'owner' order by m.created_at limit 1)`,
      ownerName: sql<string | null>`(select m.name from ${s.memberships} m where m.org_id = organizations.id and m.role = 'owner' order by m.created_at limit 1)`,
      industry: sql<string | null>`(select b.industry from ${s.brands} b where b.org_id = organizations.id order by b.created_at limit 1)`,
      lastConversation: sql<Date | null>`(select max(c.started_at) from ${s.conversations} c join ${s.brands} b on b.id = c.brand_id where b.org_id = organizations.id)`,
      leads: sql<number>`(select count(*)::int from ${s.leads} l join ${s.brands} b on b.id = l.brand_id where b.org_id = organizations.id)`,
      paidPaise: sql<number>`(select coalesce(sum(p.amount_paise), 0)::int from ${s.payments} p where p.org_id = organizations.id and p.status in ('verified', 'captured'))`,
    })
    .from(s.organizations)
    .orderBy(desc(s.organizations.createdAt));

  return Promise.all(
    orgs.map(async (r) => ({
      id: r.org.id,
      slug: r.org.slug,
      name: r.org.name,
      createdAt: r.org.createdAt,
      owner: r.owner,
      ownerName: r.ownerName,
      industry: industryFor(r.industry).label,
      lastConversation: r.lastConversation ? new Date(r.lastConversation) : null,
      leads: r.leads,
      paidRupees: r.paidPaise / 100,
      account: await accountState(r.org.id),
    })),
  );
}

export async function getAccount(slug: string) {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, slug)).limit(1);
  if (!org) return null;
  const [account, brands, people, payments] = await Promise.all([
    accountState(org.id),
    db.select().from(s.brands).where(eq(s.brands.orgId, org.id)).orderBy(s.brands.createdAt),
    db
      .select({ name: s.memberships.name, email: s.memberships.email, role: s.memberships.role, status: s.memberships.status, lastActiveAt: s.memberships.lastActiveAt })
      .from(s.memberships)
      .where(eq(s.memberships.orgId, org.id))
      .orderBy(s.memberships.createdAt),
    db.select().from(s.payments).where(eq(s.payments.orgId, org.id)).orderBy(desc(s.payments.createdAt)).limit(24),
  ]);
  return { org, account, brands, people, payments };
}

export const listDemoRequests = () => db.select().from(s.demoRequests).orderBy(desc(s.demoRequests.createdAt)).limit(200);

export const listPayments = () =>
  db
    .select({ p: s.payments, org: s.organizations.name, slug: s.organizations.slug })
    .from(s.payments)
    .leftJoin(s.organizations, eq(s.organizations.id, s.payments.orgId))
    .orderBy(desc(s.payments.createdAt))
    .limit(200);
