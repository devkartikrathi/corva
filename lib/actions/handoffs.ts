"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { checkAuthority } from "@/lib/agent/authority";
import { loadAgentConfig } from "@/lib/agent/config";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Handoff actions.
 *
 * Each one re-derives the session server-side and checks the capability
 * before touching a row — a form post is not evidence that the person was
 * allowed to press the button. Every consequential change writes an audit row.
 */

async function audit(entry: {
  orgId: string;
  brandId?: string | null;
  actorId: string;
  actorName: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
}) {
  await db.insert(s.auditLog).values({
    orgId: entry.orgId,
    brandId: entry.brandId ?? null,
    actorType: "user",
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
  });
}

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
