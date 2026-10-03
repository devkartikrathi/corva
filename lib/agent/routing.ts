import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { can, type Role } from "@/lib/auth/permissions";

/**
 * Who a handed-over call should ring at.
 *
 * The design's promise is that a customer is never asked to explain themselves
 * twice. Half of that is the written brief; the other half is this — choosing a
 * person rather than dropping the call into a queue and hoping. A queue nobody
 * is named on is a queue everyone assumes someone else is working.
 *
 * The order below is the order a supervisor would use, and it is deliberate:
 *
 *   1. whoever is already talking to this customer — continuity beats skill,
 *      because the alternative is the customer starting again with a stranger
 *   2. whoever owns the account
 *   3. free, and rated highest, with the lightest queue breaking the tie
 *
 * Anyone who has already declined this handoff is skipped at every step, so
 * re-routing does not offer it straight back to the person who just passed.
 * If nobody is available at all the handoff still exists and still appears in
 * the queue — routing failing is not a reason to lose a customer.
 */

export type Candidate = {
  membershipId: string;
  name: string;
  role: Role;
  rating: number | null;
  availability: "available" | "busy" | "offline";
  /** Handoffs already on their plate, waiting or accepted. */
  openHandoffs: number;
  /** A test account an owner made to see the console as a role (lib/auth/view-as.ts). */
  isTest: boolean;
};

export type Routing = {
  membershipId: string;
  name: string;
  /** Printed in the alert, so nobody has to guess why it rang at them. */
  reason: string;
} | null;

/** Roles that may be handed a live customer at all. */
const canTakeCalls = (role: Role) => can({ role, brandIds: null }, "calls.handle").allowed;

/**
 * Everyone in the org who could take this brand's calls, with the numbers
 * routing sorts on.
 *
 * Brand scope is applied here rather than filtered afterwards: a membership
 * scoped to one brand must never be offered another brand's customer, and that
 * is an authorization rule, not a preference about who is convenient.
 */
export async function candidatesFor(orgId: string, brandId: string): Promise<Candidate[]> {
  const rows = await db
    .select({
      membership: s.memberships,
      /**
       * Brand scope. Expressed as a row in `membership_brands`, except for
       * `all_brands`, which means every brand and needs no row.
       *
       * Outer columns are written out in full — `memberships.id`, not
       * `${"$"}{s.memberships.id}`. Inside a raw `sql` template drizzle emits a
       * bare `"id"`, and Postgres binds that to whichever table is in scope,
       * which inside `from handoffs h` is `h.id`. It does not error; it just
       * quietly matches nothing.
       */
      scoped: sql<boolean>`(
        memberships.all_brands
        or exists (
          select 1 from ${s.membershipBrands} mb
          where mb.membership_id = memberships.id and mb.brand_id = ${brandId}::uuid
        )
      )`,
      openHandoffs: sql<number>`(
        select count(*)::int from ${s.handoffs} h
        where h.status in ('waiting', 'accepted')
          and (h.accepted_by_membership_id = memberships.id
               or h.routed_to_membership_id = memberships.id)
      )`,
    })
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active")));

  return rows
    .filter((r) => r.scoped && canTakeCalls(r.membership.role))
    .map((r) => ({
      membershipId: r.membership.id,
      name: r.membership.name,
      role: r.membership.role,
      rating: r.membership.rating,
      availability: r.membership.availability,
      openHandoffs: r.openHandoffs,
      isTest: Boolean(r.membership.clerkUserId?.startsWith("test:")),
    }))
    // A test account is rung only when someone has made it Available on purpose.
    .filter((c) => !c.isTest || c.availability === "available");
}

/** Free first, then best rated, then whoever is carrying least. */
function bestOf(candidates: Candidate[]): Candidate | undefined {
  return [...candidates]
    .filter((c) => c.availability === "available")
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        a.openHandoffs - b.openHandoffs ||
        a.name.localeCompare(b.name),
    )[0];
}

export async function routeHandoff(opts: {
  orgId: string;
  brandId: string;
  customerId: string | null;
  /** Membership ids that have already passed on this one. */
  declinedBy?: string[];
}): Promise<Routing> {
  const { orgId, brandId, customerId, declinedBy = [] } = opts;

  const all = await candidatesFor(orgId, brandId);
  const candidates = all.filter((c) => !declinedBy.includes(c.membershipId));
  if (candidates.length === 0) return null;
  const byId = new Map(candidates.map((c) => [c.membershipId, c]));

  if (customerId) {
    // 1. Already in conversation with them. "Recently" is thirty days: the
    //    person who handled last week's complaint is the right person for this
    //    week's; the person who handled one in March is a stranger again.
    const recent = await db
      .select({ membershipId: s.handoffs.acceptedByMembershipId })
      .from(s.handoffs)
      .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
      .where(
        and(
          eq(s.conversations.customerId, customerId),
          sql`${s.handoffs.acceptedAt} > now() - interval '30 days'`,
        ),
      )
      .orderBy(desc(s.handoffs.acceptedAt));

    for (const row of recent) {
      const c = row.membershipId ? byId.get(row.membershipId) : undefined;
      if (c && c.availability === "available") {
        return { membershipId: c.membershipId, name: c.name, reason: "Already handling this customer" };
      }
    }

    // 2. Owns the account.
    const [customer] = await db
      .select({ ownerMembershipId: s.customers.ownerMembershipId })
      .from(s.customers)
      .where(eq(s.customers.id, customerId))
      .limit(1);

    const owner = customer?.ownerMembershipId ? byId.get(customer.ownerMembershipId) : undefined;
    if (owner && owner.availability === "available") {
      return { membershipId: owner.membershipId, name: owner.name, reason: "Owns this account" };
    }
  }

  // 3. Free, best rated, lightest queue.
  const best = bestOf(candidates);
  if (best) {
    const rating = best.rating === null ? "" : ` · rated ${best.rating.toFixed(1)}`;
    return {
      membershipId: best.membershipId,
      name: best.name,
      reason: `Free now${rating}`,
    };
  }

  // Nobody is available. The handoff is still real; it simply waits in the
  // queue for whoever comes back, rather than being assigned to someone who
  // has said they cannot take it.
  return null;
}

/**
 * Route a handoff that already exists, and record the decision on it.
 *
 * Separate from `routeHandoff` so the choice can be made without committing to
 * it — the Handoffs screen shows who it *would* go to before anyone accepts.
 */
export async function assignHandoff(handoffId: string): Promise<Routing> {
  const [row] = await db
    .select({ handoff: s.handoffs, orgId: s.brands.orgId, customerId: s.conversations.customerId })
    .from(s.handoffs)
    .innerJoin(s.brands, eq(s.brands.id, s.handoffs.brandId))
    .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
    .where(eq(s.handoffs.id, handoffId))
    .limit(1);
  if (!row) return null;

  const routing = await routeHandoff({
    orgId: row.orgId,
    brandId: row.handoff.brandId,
    customerId: row.customerId,
    declinedBy: (row.handoff.declinedBy ?? []) as string[],
  });

  await db
    .update(s.handoffs)
    .set({
      routedToMembershipId: routing?.membershipId ?? null,
      routedAt: routing ? new Date() : null,
      routingReason: routing?.reason ?? null,
    })
    .where(eq(s.handoffs.id, handoffId));

  return routing;
}
