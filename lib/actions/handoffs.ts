"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { checkAuthority } from "@/lib/agent/authority";
import { loadAgentConfig } from "@/lib/agent/config";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";

/**
 * Handoff actions.
 *
 * Each one re-derives the session server-side and checks the capability
 * before touching a row — a form post is not evidence that the person was
 * allowed to press the button. Every consequential change writes an audit row.
 */

/** Take a handoff off the queue and onto yourself. */
export async function acceptHandoff(handoffId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const [handoff] = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.id, handoffId), eq(s.handoffs.brandId, brand.id)))
    .limit(1);
  if (!handoff) throw new Error("No such handoff in this brand.");

  await db
    .update(s.handoffs)
    .set({
      status: "accepted",
      acceptedAt: new Date(),
      acceptedByMembershipId: session.membershipId,
    })
    .where(eq(s.handoffs.id, handoffId));

  await db
    .update(s.conversations)
    .set({ handledBy: session.name })
    .where(eq(s.conversations.id, handoff.conversationId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "handoff.accepted",
    target: handoffId,
  });

  revalidatePath("/app/handoffs");
  revalidatePath("/app");
}

/**
 * Approve the decision a brief isolates.
 *
 * The ceiling is checked twice on purpose: `assertCan` decides whether this
 * *role* may approve an amount at all, and `checkAuthority` records what the
 * AI was refused, so the two limits stay independent.
 */
export async function approveHandoffDecision(handoffId: string, approve: boolean) {
  const { session, brand } = await getConsoleContext();

  const [handoff] = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.id, handoffId), eq(s.handoffs.brandId, brand.id)))
    .limit(1);
  if (!handoff) throw new Error("No such handoff in this brand.");

  const refused = await db
    .select()
    .from(s.conversationActions)
    .where(
      and(
        eq(s.conversationActions.conversationId, handoff.conversationId),
        eq(s.conversationActions.allowed, false),
      ),
    )
    .limit(1);

  const amountPence = refused[0]?.amountPence ?? 0;
  assertCan(session.actor, "actions.approve_above_ceiling", { brandId: brand.id, amountPence });

  if (approve && refused[0]) {
    const config = await loadAgentConfig(brand.id);
    // Record the human's approval as its own action rather than rewriting the
    // refusal — the transcript should show that the AI declined and a person
    // then decided.
    await db.insert(s.conversationActions).values({
      conversationId: handoff.conversationId,
      action: refused[0].action,
      label: `${refused[0].label} — approved by ${session.name}`,
      amountPence: refused[0].amountPence,
      allowed: true,
    });

    if (config) {
      const decision = checkAuthority(config, refused[0].action, amountPence ?? undefined);
      if (decision.allowed) {
        // The AI could have done this itself; the ceiling has since moved.
        await audit({
          orgId: session.orgId,
          brandId: brand.id,
          actorId: session.membershipId,
          actorName: session.name,
          action: "authority.ceiling_now_covers",
          target: refused[0].action,
        });
      }
    }
  }

  await db
    .update(s.handoffs)
    .set({
      status: "resolved",
      resolution: approve ? "approved" : "declined",
      acceptedByMembershipId: session.membershipId,
      acceptedAt: handoff.acceptedAt ?? new Date(),
    })
    .where(eq(s.handoffs.id, handoffId));

  await db
    .update(s.conversations)
    .set({ status: "resolved", outcome: "human_resolved", handledBy: session.name })
    .where(eq(s.conversations.id, handoff.conversationId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: approve ? "handoff.approved" : "handoff.declined",
    target: handoffId,
    meta: { amountPence },
  });

  revalidatePath("/app/handoffs");
  revalidatePath("/app");
  revalidatePath("/app/conversations");
}

/**
 * Hand a queued brief to someone else.
 *
 * Distinct from accepting it: a manager triaging the queue is deciding who
 * should take a case, not taking it themselves. The handoff moves to
 * `accepted` against that person, so it leaves the waiting queue and appears
 * as theirs rather than sitting unclaimed with a name attached.
 */
export async function reassignHandoff(handoffId: string, membershipId: string | null) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });

  const [handoff] = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.id, handoffId), eq(s.handoffs.brandId, brand.id)))
    .limit(1);
  if (!handoff) throw new Error("No such handoff in this brand.");
  if (handoff.status === "resolved") throw new Error("That handoff is already resolved.");

  if (membershipId === null) {
    // Putting it back on the queue: clear the owner rather than leaving a
    // stale name on a row nobody is actually working.
    await db
      .update(s.handoffs)
      .set({ status: "waiting", acceptedAt: null, acceptedByMembershipId: null })
      .where(eq(s.handoffs.id, handoffId));
    await db
      .update(s.conversations)
      .set({ handledBy: null })
      .where(eq(s.conversations.id, handoff.conversationId));
  } else {
    const [member] = await db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, session.orgId)))
      .limit(1);
    if (!member) throw new Error("That person is not in this workspace.");
    if (member.status !== "active") throw new Error(`${member.name} has not accepted their invite yet.`);

    await db
      .update(s.handoffs)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByMembershipId: membershipId,
      })
      .where(eq(s.handoffs.id, handoffId));
    await db
      .update(s.conversations)
      .set({ handledBy: member.name })
      .where(eq(s.conversations.id, handoff.conversationId));
  }

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: membershipId ? "handoff.reassigned" : "handoff.returned_to_queue",
    target: handoffId,
    meta: { to: membershipId },
  });

  revalidatePath("/app/handoffs");
  revalidatePath("/app");
}
