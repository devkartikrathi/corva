"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { defaultFields, saveIntakeFields, type IntakeField } from "@/lib/business/intake";
import { audit } from "./audit";

/**
 * Changing what the AI collects.
 *
 * Takes effect on the next conversation — and on the next turn of a live
 * chat, since the agent reads the list each time it answers. Gated like the
 * rest of the agent's behaviour: whoever may publish a change to the agent
 * may change this.
 */

function refresh() {
  revalidatePath("/app/details");
  revalidatePath("/app/live");
  revalidatePath("/app/leads");
  revalidatePath("/app/conversations");
}

export async function saveDetailsToCollect(fields: Omit<IntakeField, "builtIn">[]) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id, publishing: true });
  if (!Array.isArray(fields)) throw new Error("Nothing to save.");

  const saved = await saveIntakeFields(brand.id, fields);
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "intake.fields_saved",
    target: brand.id,
    meta: { fields: saved.map((f) => f.key) },
  });
  refresh();
  return saved;
}

/** Back to what the business's industry starts with. */
export async function resetDetailsToCollect() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id, publishing: true });

  const saved = await saveIntakeFields(brand.id, defaultFields(brand.industry));
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "intake.fields_reset",
    target: brand.id,
  });
  refresh();
  return saved;
}
