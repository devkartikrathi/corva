"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { AuthorizationError, assertCan } from "@/lib/auth/permissions";
import { DataSourceError } from "@/lib/data/postgres";
import { askData, connectSource, deleteLookup, disconnectSource, refreshSource, saveLookup, suggestLookups, tryLookup, type LookupInput } from "@/lib/data/sources";
import { audit } from "./audit";
import { allow } from "@/lib/rate-limit";

/**
 * Connecting the business's own database, and deciding what the assistant may
 * look up in it.
 *
 * Gated like the rest of Settings: a connection is a credential, and a lookup
 * decides what a stranger on the website can be told. Every change is in the
 * audit log; the connection string itself never is.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Failures come back as values, not exceptions: a production build hides a
 * thrown message from the browser, and "the column order_no does not exist" is
 * exactly what the person writing a lookup needs to read.
 */
async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof DataSourceError) return { ok: false, error: e.message };
    if (e instanceof AuthorizationError) return { ok: false, error: "Your role cannot change this. Ask an owner or admin." };
    console.error("[data]", e);
    return { ok: false, error: "That did not work. Try again in a moment." };
  }
}

async function owner() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const log = (action: string, target: string, meta?: Record<string, unknown>) =>
    audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action, target, meta });
  return { session, brand, log };
}

export async function connectDatabase(name: string, connection: string) {
  return attempt(async () => {
    const { session, brand, log } = await owner();
    const source = await connectSource(brand.id, { name, connection }, session.name);
    await log("data_source.connected", `${source.host}/${source.databaseName}`, { tables: source.snapshot.tables.length });
    revalidatePath("/app/data");
    return { tables: source.snapshot.tables.length };
  });
}

export async function refreshDatabase() {
  return attempt(async () => {
    const { brand } = await owner();
    const snapshot = await refreshSource(brand.id);
    revalidatePath("/app/data");
    return { tables: snapshot.tables.length };
  });
}

export async function disconnectDatabase() {
  return attempt(async () => {
    const { brand, log } = await owner();
    const source = await disconnectSource(brand.id);
    if (source) await log("data_source.disconnected", `${source.host}/${source.databaseName}`);
    revalidatePath("/app/data");
  });
}

export async function saveDataLookup(input: LookupInput) {
  return attempt(async () => {
    const { brand, log } = await owner();
    const saved = await saveLookup(brand.id, input);
    await log(input.id ? "data_lookup.saved" : "data_lookup.created", saved.key, { enabled: saved.enabled });
    revalidatePath("/app/data");
    return saved;
  });
}

export async function removeDataLookup(id: string) {
  return attempt(async () => {
    const { brand, log } = await owner();
    const removed = await deleteLookup(brand.id, id);
    await log("data_lookup.removed", removed.key);
    revalidatePath("/app/data");
  });
}

export async function testDataLookup(input: LookupInput, values: Record<string, string>) {
  return attempt(async () => {
    const { brand } = await owner();
    return tryLookup(brand.id, input, values);
  });
}

export async function suggestDataLookups() {
  return attempt(async () => {
    const { session, brand } = await owner();
    if (!(await allow(`suggest:${session.membershipId}`, 10, 3600))) throw new DataSourceError("That is a lot of suggestions for one hour. Try again later, or write the lookup yourself.");
    return suggestLookups(brand);
  });
}

export async function askDatabase(question: string) {
  return attempt(async () => {
    const { session, brand, log } = await owner();
    if (!(await allow(`ask:${session.membershipId}`, 40, 3600))) throw new DataSourceError("That is a lot of questions for one hour. Try again a little later.");
    const answer = await askData(brand, question);
    // The question is the record; the rows that came back are the business's own.
    await log("data_source.asked", question.slice(0, 200), { rows: answer.result?.rows.length ?? 0 });
    return answer;
  });
}
