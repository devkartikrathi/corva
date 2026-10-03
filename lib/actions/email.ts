"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { replyOnThread } from "@/lib/email/inbound";
import { audit } from "./audit";

/** Answer a customer's email thread from Corva, in the business's name. */
export async function replyToEmail(conversationId: string, body: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "calls.handle", { brandId: brand.id });
  await replyOnThread(conversationId, { id: brand.id, name: brand.name, slug: brand.slug }, body, session.name);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "email.replied", target: conversationId });
  revalidatePath("/app/email");
  revalidatePath("/app/conversations");
}
