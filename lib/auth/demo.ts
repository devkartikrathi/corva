import { and, eq, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DEMO_MODE } from "./mode";
import { PROFILE_COOKIE } from "./profile";
import type { TenantSession } from "./session";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who demo mode signs you in as, when nothing has been chosen.
 *
 * A Manager, because that is the screen with the most on it and the one
 * someone opening the app cold should land on. The switcher in the sidebar
 * moves it, and any seeded email works here.
 */
const DEMO_MEMBER_EMAIL = process.env.CORVA_DEMO_EMAIL ?? "dania@aureliusgroup.com";

export const getDemoTenantSession = cache(async (): Promise<TenantSession | null> => {
  if (!demoEnabled()) return null;

  /**
   * The chosen profile, or the default.
   *
   * Both cases are one query. An unknown or stale id simply matches nothing
   * and falls through to the default rather than erroring — the cookie
   * expresses a preference, and a preference that can no longer be honoured is
   * not a failure. Only `active` memberships are reachable: an invite nobody
   * has accepted yet is not a person you can be.
   */
  const raw = (await cookies()).get(PROFILE_COOKIE)?.value;
  // A cookie is something the browser sends, not something the server trusts.
  // Postgres raises on a malformed uuid rather than matching nothing, so the
  // shape is checked before the value reaches a comparison.
  const chosen = raw && UUID.test(raw) ? raw : undefined;

  const rows = await db
    .select({ membership: s.memberships, org: s.organizations })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(
      and(
        eq(s.memberships.status, "active"),
        or(
          chosen ? eq(s.memberships.id, chosen) : undefined,
          eq(s.memberships.email, DEMO_MEMBER_EMAIL),
        ),
      ),
    )
    .limit(2);

  const row = rows.find((r) => r.membership.id === chosen) ?? rows[0];

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
    availability: row.membership.availability,
    brandIds,
    actor: { role: row.membership.role, brandIds },
  };
});
