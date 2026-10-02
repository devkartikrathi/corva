"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { AuthorizationError, assertCan } from "@/lib/auth/permissions";
import { DataSourceError } from "@/lib/data/postgres";
import { connectMailbox, disconnectMailbox, syncMailbox } from "@/lib/email/mailbox";
import { audit } from "./audit";

/**
 * Connecting the business's inbox.
 *
 * An inbox is a credential and a lot of other people's words, so connecting
 * and disconnecting it is an owner's or admin's act and is in the audit log.
 * Failures come back as values: the reason a mail server refused is what the
 * person connecting it needs to read.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof DataSourceError) return { ok: false, error: e.message };
    if (e instanceof AuthorizationError) return { ok: false, error: "Your role cannot change this. Ask an owner or admin." };
    console.error("[email]", e);
    return { ok: false, error: "That did not work. Try again in a moment." };
  }
}

function refresh() {
  revalidatePath("/app/email");
  revalidatePath("/app/overview");
  revalidatePath("/app/conversations");
  revalidatePath("/app/customers");
}

export async function connectInbox(input: { address: string; password: string; host: string }) {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "people.manage", { brandId: brand.id });
    const box = await connectMailbox(brand.id, input, session.name);
    await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "mailbox.connected", target: box.address });
    // The first read, so the screen they land on is not empty.
    const read = await syncMailbox(brand).catch(() => null);
    refresh();
    return { address: box.address, kept: read?.kept ?? 0, looked: read?.looked ?? 0 };
  });
}

export async function disconnectInbox() {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "people.manage", { brandId: brand.id });
    const box = await disconnectMailbox(brand.id);
    if (box) await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "mailbox.disconnected", target: box.address });
    refresh();
  });
}

/** Read the inbox now. Anyone who can see customers may ask for it. */
export async function checkInbox() {
  return attempt(async () => {
    const { session, brand } = await getConsoleContext();
    assertCan(session.actor, "customers.read", { brandId: brand.id });
    const read = await syncMailbox(brand);
    refresh();
    return read ?? { looked: 0, kept: 0 };
  });
}
