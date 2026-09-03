import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DEMO_MODE } from "./mode";
import type { StaffSession, TenantSession } from "./session";

/**
 * Demo mode.
 *
 * With `CORVA_DEMO=1` the consoles open without signing in, as a seeded
 * member of the seeded workspace. Everything downstream — brand scoping,
 * the role matrix, audit rows — behaves exactly as it does for a real
 * session, because this only substitutes *who is asking*, never what they
 * are allowed to do.
 *
 * Set `CORVA_DEMO=0` to require Clerk.
 */

export const demoEnabled = () => DEMO_MODE;

/** Who demo mode signs you in as. Any seeded email works. */
const DEMO_MEMBER_EMAIL = process.env.CORVA_DEMO_EMAIL ?? "dania@aureliusgroup.com";
const DEMO_STAFF_EMAIL = process.env.CORVA_DEMO_STAFF_EMAIL ?? "you@corva.systems";

export const getDemoTenantSession = cache(async (): Promise<TenantSession | null> => {
  if (!demoEnabled()) return null;

  const [row] = await db
    .select({ membership: s.memberships, org: s.organizations })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(eq(s.memberships.email, DEMO_MEMBER_EMAIL))
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
    clerkUserId: `demo:${row.membership.email}`,
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

export const getDemoStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (!demoEnabled()) return null;

  const [row] = await db.select().from(s.staff).where(eq(s.staff.email, DEMO_STAFF_EMAIL)).limit(1);
  if (!row) return null;

  return {
    kind: "staff",
    clerkUserId: `demo:${row.email}`,
    staffId: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.isAdmin,
  };
});
