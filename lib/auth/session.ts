import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
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
  /** Whether they have said they can be handed a call right now. */
  availability: "available" | "busy" | "offline";
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
 * Bind whatever is waiting for this email to the account that just signed in.
 *
 * An invitation is a membership row with an email and no Clerk id — made by
 * onboarding for a business's Owner, or by a colleague from the Team screen.
 * Signing in (or up) with that email *is* accepting it: the row gets the
 * Clerk id, turns active, and its single-use token is spent. The same goes
 * for rows the seed or demo mode created, so the fixture team and demo
 * businesses become real accounts rather than a parallel set.
 *
 * Only a verified email counts. Clerk verifies at sign-up, but an unverified
 * secondary address must never be enough to walk into someone's workspace.
 */
async function claimByEmail(clerkUserId: string, email: string) {
  const address = email.trim().toLowerCase();
  await db
    .update(s.memberships)
    .set({ clerkUserId, status: "active", inviteToken: null, lastActiveAt: new Date() })
    .where(
      and(
        sql`lower(${s.memberships.email}) = ${address}`,
        or(
          isNull(s.memberships.clerkUserId),
          like(s.memberships.clerkUserId, "seed:%"),
          like(s.memberships.clerkUserId, "demo:%"),
        ),
        inArray(s.memberships.status, ["invited", "active"]),
      ),
    );

  await db
    .update(s.staff)
    .set({ clerkUserId })
    .where(and(eq(s.staff.email, address), eq(s.staff.clerkUserId, "staff_seed_operator")));
}

/** The signed-in tenant member, or null. Memoised per request. */
/** Calling Clerk at all is unsafe when it is not mounted. */
const clerkConfigured = () =>
  !DEMO_MODE && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const getTenantSession = cache(async (): Promise<TenantSession | null> => {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  // Only look for something to claim when there is nothing bound yet — this
  // runs on every request, and a claimed account never needs it again.
  const [bound] = await db
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(and(eq(s.memberships.clerkUserId, userId), eq(s.memberships.status, "active")))
    .limit(1);
  if (!bound) {
    const user = await currentUser();
    const primary = user?.primaryEmailAddress;
    if (primary && primary.verification?.status === "verified") {
      await claimByEmail(userId, primary.emailAddress);
    }
  }

  const [row] = await db
    .select({
      membership: s.memberships,
      org: s.organizations,
    })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(and(eq(s.memberships.clerkUserId, userId), eq(s.memberships.status, "active")))
    .orderBy(s.memberships.createdAt)
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
    availability: row.membership.availability,
    brandIds,
    actor: { role: row.membership.role, brandIds },
  };
});

/** The signed-in Corva staff member, or null. Never derived from a tenant role. */
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  let [row] = await db.select().from(s.staff).where(eq(s.staff.clerkUserId, userId)).limit(1);
  if (!row) {
    // Not staff yet — but on the list? `CORVA_STAFF_EMAILS` is who may run
    // Corva's own console; a verified address on it becomes a staff member the
    // first time they sign in. Nothing a tenant controls can put anyone there.
    const allowed = (process.env.CORVA_STAFF_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) return null;
    const user = await currentUser();
    const primary = user?.primaryEmailAddress;
    const email = primary?.emailAddress.toLowerCase();
    if (!email || primary?.verification?.status !== "verified" || !allowed.includes(email)) return null;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || email.split("@")[0];
    [row] = await db
      .insert(s.staff)
      .values({ clerkUserId: userId, email, name, isAdmin: true })
      .onConflictDoUpdate({ target: s.staff.email, set: { clerkUserId: userId } })
      .returning();
  }

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
