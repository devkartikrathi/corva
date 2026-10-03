"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getConsoleContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { assertCan } from "@/lib/auth/permissions";
import { inboxFor, replyOnThread } from "@/lib/email/inbound";
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

/** Whether the assistant answers this business's customer email itself. */
export async function setEmailAssistant(on: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await inboxFor(brand.id, brand.slug);
  await db.update(s.emailInboxes).set({ aiReplies: Boolean(on) }).where(eq(s.emailInboxes.brandId, brand.id));
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: on ? "email.assistant_on" : "email.assistant_off", target: brand.id });
  revalidatePath("/app/email");
}
