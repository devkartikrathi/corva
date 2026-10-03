"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { AuthorizationError, assertCan } from "@/lib/auth/permissions";
import { DataSourceError } from "@/lib/data/postgres";
import { connectWhatsApp, disconnectWhatsApp, saveOpeningTemplate } from "@/lib/whatsapp/cloud";
import { audit } from "./audit";

/**
 * Connecting the business's WhatsApp number. An owner's or admin's act, in
 * the audit log; the token and app secret never are.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof DataSourceError) return { ok: false, error: e.message };
    if (e instanceof AuthorizationError) return { ok: false, error: "Your role cannot change this. Ask an owner or admin." };
    console.error("[whatsapp]", e);
    return { ok: false, error: "That did not work. Try again in a moment." };
  }
}

export async function connectWhatsAppNumber(input: { phoneNumberId: string; token: string; appSecret: string }) {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "people.manage", { brandId: brand.id });
    const row = await connectWhatsApp(brand.id, input, session.name);
    await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "whatsapp.connected", target: row.displayNumber });
    revalidatePath("/app/whatsapp");
    return { number: row.displayNumber };
  });
}

export async function disconnectWhatsAppNumber() {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "people.manage", { brandId: brand.id });
    const row = await disconnectWhatsApp(brand.id);
    if (row) await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "whatsapp.disconnected", target: row.displayNumber });
    revalidatePath("/app/whatsapp");
  });
}

/** The template Meta approved for writing to a customer first. Null removes it. */
export async function saveWhatsAppOpeningTemplate(template: { name: string; language: string; nameParam: boolean } | null) {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "people.manage", { brandId: brand.id });
    await saveOpeningTemplate(brand.id, template);
    await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "whatsapp.opening_template", target: template?.name ?? "removed" });
    revalidatePath("/app/whatsapp");
    return { saved: true };
  });
}
