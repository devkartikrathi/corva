"use server";

import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inviteEmail, sendEmail } from "@/lib/email";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { accountState } from "@/lib/billing/usage";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan, ROLES, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";

/**
 * People and roles.
 *
 * Two rules run through everything here, and they are the reason the checks
 * look repetitive. Nobody may grant a capability they do not hold — otherwise
 * `people.manage` is a back door to every other permission — and the last
 * Owner cannot be removed or demoted, because an organization with no Owner
 * has no one who can undo it.
 */

async function assertNotLastOwner(orgId: string, membershipId: string) {
  const owners = await db
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.orgId, orgId),
        eq(s.memberships.role, "owner"),
        eq(s.memberships.status, "active"),
      ),
    );
  if (owners.length <= 1 && owners.some((o) => o.id === membershipId)) {
    throw new Error("This is the only Owner. Promote someone else first.");
  }
}

/** Roles this person may hand out — never one above their own. */
function assignableRoles(actorRole: Role): Role[] {
  const rank = ROLES.indexOf(actorRole);
  return ROLES.slice(rank) as Role[];
}

export async function inviteMember(input: {
  email: string;
  name: string;
  role: Role;
  brandIds: string[];
  allBrands: boolean;
}) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });

  const account = await accountState(session.orgId);
  if (account.counts.members >= account.plan.members) {
    throw new Error(
      `The ${account.plan.name} plan covers ${account.plan.members} team members and they are all taken. Remove someone, or move up a plan in Billing.`,
    );
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That is not an email address.");
  const name = input.name.trim() || email.split("@")[0];

  if (!assignableRoles(session.role).includes(input.role)) {
    throw new Error(`You cannot invite someone as ${input.role} — it is above your own role.`);
  }
  if (!input.allBrands && input.brandIds.length === 0) {
    throw new Error("Pick at least one brand, or give access to all of them.");
  }

  const [existing] = await db
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.orgId, session.orgId), eq(s.memberships.email, email)))
    .limit(1);
  if (existing) throw new Error(`${email} is already in this workspace.`);

  const [membership] = await db
    .insert(s.memberships)
    .values({
      orgId: session.orgId,
      // No Clerk id until they accept: that absence is what "invited" means.
      clerkUserId: null,
      email,
      name,
      role: input.role,
      status: "invited",
      inviteToken: randomUUID(),
      invitedByName: session.name,
      allBrands: input.allBrands,
      invitedAt: new Date(),
    })
    .returning();

  if (!input.allBrands && input.brandIds.length) {
    const brands = await db
      .select({ id: s.brands.id })
      .from(s.brands)
      .where(and(eq(s.brands.orgId, session.orgId), inArray(s.brands.id, input.brandIds)));
    if (brands.length) {
      await db
        .insert(s.membershipBrands)
        .values(brands.map((b) => ({ membershipId: membership.id, brandId: b.id })));
    }
  }

  // The invitation itself. Best-effort: the row exists either way, and the
  // Team screen can show the link if the email did not go.
  const mail = inviteEmail({
    orgName: session.orgName,
    role: ROLE_LABELS[input.role],
    invitedBy: session.name,
    token: membership.inviteToken!,
  });
  const sent = await sendEmail({ to: email, ...mail, replyTo: session.email });

  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "people.invited",
    target: email,
    meta: { role: input.role, emailed: sent.sent },
  });

  revalidatePath("/app/team");
  return { emailed: sent.sent, reason: sent.reason ?? null };
}

export async function changeRole(membershipId: string, role: Role) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });

  if (!assignableRoles(session.role).includes(role)) {
    throw new Error(`You cannot grant ${role} — it is above your own role.`);
  }

  const [member] = await db
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, session.orgId)))
    .limit(1);
  if (!member) throw new Error("That person is not in this workspace.");
  if (member.role === "owner" && role !== "owner") await assertNotLastOwner(session.orgId, membershipId);

  await db.update(s.memberships).set({ role }).where(eq(s.memberships.id, membershipId));

  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "people.role_changed",
    target: member.email,
    meta: { from: member.role, to: role },
  });

  revalidatePath("/app/team");
}


/**
 * Suspend rather than delete.
 *
 * A membership is referenced by handoffs, notes and audit rows; removing it
 * would either orphan those or take history with it. Suspension stops access
 * and leaves the record of what they did intact.
 */
export async function suspendMember(membershipId: string, suspended: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });

  const [member] = await db
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, session.orgId)))
    .limit(1);
  if (!member) throw new Error("That person is not in this workspace.");
  if (member.id === session.membershipId) throw new Error("You cannot suspend yourself.");
  if (suspended) await assertNotLastOwner(session.orgId, membershipId);

  await db
    .update(s.memberships)
    .set({ status: suspended ? "suspended" : "active" })
    .where(eq(s.memberships.id, membershipId));

  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: suspended ? "people.suspended" : "people.reinstated",
    target: member.email,
  });

  revalidatePath("/app/team");
}

/** Withdraw an invite nobody has accepted. */
export async function revokeInvite(membershipId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });

  const [member] = await db
    .select()
    .from(s.memberships)
    .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, session.orgId)))
    .limit(1);
  if (!member) throw new Error("That person is not in this workspace.");
  if (member.status !== "invited") throw new Error("That invite has already been accepted.");

  await db.delete(s.memberships).where(eq(s.memberships.id, membershipId));

  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "people.invite_revoked",
    target: member.email,
  });

  revalidatePath("/app/team");
}

