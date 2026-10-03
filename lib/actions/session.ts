"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { BRAND_COOKIE } from "@/lib/auth/brand";
import { demoEnabled } from "@/lib/auth/demo";
import { PROFILE_COOKIE } from "@/lib/auth/profile";
import { getTenantSession } from "@/lib/auth/session";
import { TEST_IDENTITY_PREFIX, TEST_ROLES, VIEW_AS_COOKIE, testAccounts } from "@/lib/auth/view-as";
import { audit } from "./audit";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Put a different brand in view.
 *
 * The choice is a cookie rather than a path segment because it survives
 * navigation between the twelve screens, and because it is a preference, not
 * an address — two people looking at `/app/handoffs` are looking at the same
 * screen even if they have different brands selected.
 *
 * The membership's brand scope is re-checked here: a cookie is something the
 * browser sends, not something the server trusts.
 */
export async function switchBrand(brandId: string) {
  const { brands } = await getConsoleContext();
  if (!brands.some((b) => b.id === brandId)) {
    throw new Error("That brand is not in your workspace.");
  }

  const jar = await cookies();
  jar.set(BRAND_COOKIE, brandId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}


/**
 * Look at the console as somebody else.
 *
 * Demo mode only, and refused outright otherwise — with Clerk on, identity
 * comes from the signed-in user and there is no legitimate reason for a
 * request to change it. What this does *not* do is as important as what it
 * does: no capability is granted, no brand scope is widened, nothing is
 * bypassed. It substitutes who is asking, and every check downstream runs
 * exactly as it would for that person signing in themselves.
 *
 * It exists because the difference between the Agent's console and the
 * Manager's console is the product, and the only convincing way to show a
 * difference between two screens is to put them one click apart.
 */
export async function switchProfile(membershipId: string) {
  if (!demoEnabled()) {
    throw new Error("Profile switching is a demo-mode affordance. Sign in as that person instead.");
  }

  const { session } = await getConsoleContext();

  // Only inside this workspace, and only somebody who actually exists in it.
  const [member] = await db
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.id, membershipId),
        eq(s.memberships.orgId, session.orgId),
        eq(s.memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!member) throw new Error("That person is not in this workspace.");

  const jar = await cookies();
  jar.set(PROFILE_COOKIE, membershipId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  revalidatePath("/app", "layout");
}

/**
 * Look at the console as one of this business's test accounts, or as
 * yourself again (`null`). Owners only — checked against who is really
 * signed in, never against whoever is being viewed as. See lib/auth/view-as.ts.
 */
export async function viewAs(membershipId: string | null) {
  const real = await getTenantSession();
  if (!real || real.role !== "owner") throw new Error("Only an owner can view the console as another role.");
  const jar = await cookies();
  if (!membershipId || membershipId === real.membershipId) {
    jar.delete(VIEW_AS_COOKIE);
    revalidatePath("/app", "layout");
    return;
  }
  const accounts = await testAccounts(real.orgId);
  const target = accounts.find((a) => a.id === membershipId);
  if (!target) throw new Error("That is not one of this business's test accounts.");
  jar.set(VIEW_AS_COOKIE, target.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  await audit({ orgId: real.orgId, actorId: real.membershipId, actorName: real.name, action: "view_as.started", target: `${target.name} (${target.role})` });
  revalidatePath("/app", "layout");
}

/**
 * One test account per role — Admin, Manager, Agent, Analyst — for viewing
 * the console as each. Made once; already-made ones are left alone. Their
 * identity (`test:…`) can never be claimed by a sign-in, and they are not
 * counted as seats.
 */
export async function createTestAccounts() {
  const real = await getTenantSession();
  if (!real || real.role !== "owner") throw new Error("Only an owner can create test accounts.");
  const existing = new Set((await testAccounts(real.orgId)).map((a) => a.role));
  const made: string[] = [];
  for (const role of TEST_ROLES) {
    if (existing.has(role)) continue;
    const label = `${role[0].toUpperCase()}${role.slice(1)}`;
    await db.insert(s.memberships).values({
      orgId: real.orgId,
      clerkUserId: `${TEST_IDENTITY_PREFIX}${real.orgId}:${role}`,
      email: `test-${role}@${real.orgSlug}.corva.test`,
      name: `Test ${label}`,
      role,
      status: "active",
      allBrands: true,
      availability: "offline",
      invitedByName: real.name,
    });
    made.push(label);
  }
  if (made.length) await audit({ orgId: real.orgId, actorId: real.membershipId, actorName: real.name, action: "test_accounts.created", target: made.join(", ") });
  revalidatePath("/app", "layout");
  return made;
}
