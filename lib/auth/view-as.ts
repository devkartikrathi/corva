import { and, eq, like } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { Role } from "./permissions";
import type { TenantSession } from "./session";

/**
 * "View as": an owner looking at the console as one of their test accounts.
 *
 * The console is a different job for each role — an Agent sees the customers
 * they hold, an Analyst reads but cannot change — and the only convincing way
 * to check a screen is to open it as that role. So an owner can create test
 * accounts (one per role) and switch into them from the header.
 *
 * What keeps it safe:
 *   - only a signed-in **owner**, and only inside their own business;
 *   - only **test accounts** — memberships whose identity is `test:…`, which
 *     no sign-in can ever claim (see `claimByEmail`) — never a real colleague;
 *   - it substitutes who is asking and nothing else: every capability check,
 *     brand scope and audit row runs exactly as it would for that account;
 *   - test accounts are never given leads or follow-ups (`pickOwner`), and are
 *     only rung for a live handoff when someone set one to Available.
 */

export const VIEW_AS_COOKIE = "corva_view_as";
export const TEST_IDENTITY_PREFIX = "test:";

export const isTestIdentity = (clerkUserId: string | null | undefined) => Boolean(clerkUserId?.startsWith(TEST_IDENTITY_PREFIX));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The roles a test account can be made for. Owners are the people themselves. */
export const TEST_ROLES: Exclude<Role, "owner">[] = ["admin", "manager", "agent", "analyst"];

/** This business's test accounts, most senior first. */
export async function testAccounts(orgId: string) {
  const rows = await db
    .select({ id: s.memberships.id, name: s.memberships.name, role: s.memberships.role, availability: s.memberships.availability })
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active"), like(s.memberships.clerkUserId, `${TEST_IDENTITY_PREFIX}%`)));
  return rows.sort((a, b) => TEST_ROLES.indexOf(a.role as never) - TEST_ROLES.indexOf(b.role as never));
}

/**
 * The session to use instead of the owner's, when they have chosen to view
 * as a test account and it still exists. Null otherwise — a stale or forged
 * cookie simply means "yourself".
 */
export async function viewAsSession(real: TenantSession): Promise<TenantSession | null> {
  return resolveViewAs(real, (await cookies()).get(VIEW_AS_COOKIE)?.value);
}

/** The test account `chosen` names, as a session — if `real` may view as it. */
export async function resolveViewAs(real: TenantSession, chosen: string | undefined): Promise<TenantSession | null> {
  if (real.role !== "owner") return null;
  if (!chosen || !UUID.test(chosen)) return null;

  const [row] = await db
    .select({ membership: s.memberships })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.id, chosen),
        eq(s.memberships.orgId, real.orgId),
        eq(s.memberships.status, "active"),
        like(s.memberships.clerkUserId, `${TEST_IDENTITY_PREFIX}%`),
      ),
    )
    .limit(1);
  if (!row) return null;
  const m = row.membership;

  const brandIds = m.allBrands
    ? null
    : (await db.select({ brandId: s.membershipBrands.brandId }).from(s.membershipBrands).where(eq(s.membershipBrands.membershipId, m.id))).map((b) => b.brandId);

  return {
    ...real,
    clerkUserId: m.clerkUserId ?? `${TEST_IDENTITY_PREFIX}${m.id}`,
    membershipId: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    availability: m.availability,
    brandIds,
    actor: { role: m.role, brandIds },
  };
}
