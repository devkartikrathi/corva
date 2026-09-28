import { and, asc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { BRAND_COOKIE } from "@/lib/auth/brand";
import { DEMO_MODE } from "@/lib/auth/mode";
import { PROFILE_COOKIE } from "@/lib/auth/profile";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Put the console into a business, as its most senior active member.
 *
 * Demo mode only. It exists so that someone showing Corva can add a business,
 * ring it, and watch the call land in *that* business's console without a
 * sign-in in between. With sign-in on it refuses: staff reach tenant content
 * through a support grant, never by becoming a tenant.
 *
 * The caller has already checked that a staff member is asking.
 */
export async function enterAsBusiness(target: { orgSlug?: string; brandId?: string }) {
  if (!DEMO_MODE) throw new Error("Opening a business as its owner only works in demo mode.");

  const [row] = await db
    .select({ membershipId: s.memberships.id, brandId: s.brands.id })
    .from(s.organizations)
    .innerJoin(s.memberships, eq(s.memberships.orgId, s.organizations.id))
    .innerJoin(s.brands, eq(s.brands.orgId, s.organizations.id))
    .where(
      and(
        target.brandId ? eq(s.brands.id, target.brandId) : eq(s.organizations.slug, target.orgSlug ?? ""),
        eq(s.memberships.status, "active"),
      ),
    )
    // Owner first, then whoever is most senior; the oldest brand by default.
    .orderBy(
      sql`array_position(array['owner','admin','manager','agent','analyst']::text[], ${s.memberships.role}::text)`,
      asc(s.brands.createdAt),
    )
    .limit(1);
  if (!row) throw new Error("Nobody in that business can be signed in as.");

  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, path: "/" };
  jar.set(PROFILE_COOKIE, row.membershipId, { ...opts, maxAge: 60 * 60 * 24 * 7 });
  jar.set(BRAND_COOKIE, row.brandId, { ...opts, maxAge: 60 * 60 * 24 * 365 });
  return row;
}
