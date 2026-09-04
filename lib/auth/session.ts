import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DEMO_MODE } from "./mode";
import type { Actor, Role } from "./permissions";

/**
 * Identity comes from Clerk; authority comes from Postgres. Clerk answers
 * "who is this", and `memberships` answers "what may they do, and where".
 */

export type TenantSession = {
  kind: "member";
  clerkUserId: string;
  membershipId: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  name: string;
  email: string;
  role: Role;
  /** Null means every brand in the org. */
  brandIds: string[] | null;
  actor: Actor;
};

export type StaffSession = {
  kind: "staff";
  clerkUserId: string;
  staffId: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

/**
 * On first sign-in a seeded membership is claimed by matching email, so the
 * fixture team becomes real accounts rather than a parallel set.
 */
async function linkSeededMembership(clerkUserId: string, email: string) {
  await db
    .update(s.memberships)
    .set({ clerkUserId, lastActiveAt: new Date() })
    .where(and(eq(s.memberships.email, email), eq(s.memberships.clerkUserId, `seed:${email}`)));

  await db
    .update(s.staff)
    .set({ clerkUserId })
    .where(and(eq(s.staff.email, email), eq(s.staff.clerkUserId, "staff_seed_operator")));
}

/** The signed-in tenant member, or null. Memoised per request. */
/** Calling Clerk at all is unsafe when it is not mounted. */
const clerkConfigured = () =>
  !DEMO_MODE && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const getTenantSession = cache(async (): Promise<TenantSession | null> => {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (email) await linkSeededMembership(userId, email);

  const [row] = await db
    .select({
      membership: s.memberships,
      org: s.organizations,
    })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(eq(s.memberships.clerkUserId, userId))
    .limit(1);

  if (!row) return null;

  const brandIds = row.membership.allBrands
    ? null
    : (
        await db
          .select({ brandId: s.membershipBrands.brandId })
          .from(s.membershipBrands)
          .where(eq(s.membershipBrands.membershipId, row.membership.id))
      ).map((b) => b.brandId);

  return {
    kind: "member",
    clerkUserId: userId,
    membershipId: row.membership.id,
    orgId: row.org.id,
    orgSlug: row.org.slug,
    orgName: row.org.name,
    name: row.membership.name,
    email: row.membership.email,
    role: row.membership.role,
    brandIds,
    actor: { role: row.membership.role, brandIds },
  };
});

/** The signed-in Corva staff member, or null. Never derived from a tenant role. */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  const [row] = await db.select().from(s.staff).where(eq(s.staff.clerkUserId, userId)).limit(1);
  if (!row) return null;

  return {
    kind: "staff",
    clerkUserId: userId,
    staffId: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.isAdmin,
  };
});


/** The brands this session may see, already scoped. */
export const getVisibleBrands = cache(async (session: TenantSession) => {
  return db
    .select()
    .from(s.brands)
    .where(
      session.brandIds === null
        ? eq(s.brands.orgId, session.orgId)
        : and(
            eq(s.brands.orgId, session.orgId),
            or(...session.brandIds.map((id) => eq(s.brands.id, id))),
          ),
    )
    .orderBy(s.brands.createdAt);
});
