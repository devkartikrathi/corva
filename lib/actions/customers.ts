"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { listCustomers, type CustomerFilters } from "@/lib/queries/customers";
import { intOf, listOf, type Params } from "@/lib/params";
import { audit } from "./audit";
import { customerForMerge, mergeCustomers, removeHandle, undoMerge } from "@/lib/crm/identity";

/**
 * Customer actions.
 *
 * Notes, consent and ownership are the three things a person changes about a
 * customer from the console; everything else on the profile is either mirrored
 * from another system or derived by the scoring engine, and pretending
 * otherwise would invite someone to edit a number that the next rescore
 * silently overwrites.
 */

async function scoped(customerId: string, brandId: string) {
  const [row] = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.id, customerId), eq(s.customers.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("No such customer in this brand.");
  return row;
}

export async function addCustomerNote(customerId: string, body: string, pinned = false) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "customers.read", { brandId: brand.id });

  const text = body.trim();
  if (!text) throw new Error("A note needs something in it.");
  if (text.length > 2000) throw new Error("Notes are capped at 2,000 characters.");

  await scoped(customerId, brand.id);
  await db.insert(s.customerNotes).values({
    customerId,
    authorMembershipId: session.membershipId,
    authorName: session.name,
    body: text,
    pinned,
  });

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "customer.note_added",
    target: customerId,
  });

  revalidatePath(`/app/customers/${customerId}`);
}

export async function deleteCustomerNote(noteId: string) {
  const { session, brand } = await getConsoleContext();

  const [note] = await db
    .select({ note: s.customerNotes, customer: s.customers })
    .from(s.customerNotes)
    .innerJoin(s.customers, eq(s.customers.id, s.customerNotes.customerId))
    .where(eq(s.customerNotes.id, noteId))
    .limit(1);
  if (!note || note.customer.brandId !== brand.id) throw new Error("No such note.");
  // Anyone may add a note; only its author or a manager may remove one.
  if (note.note.authorMembershipId !== session.membershipId && session.role === "agent") {
    throw new Error("Only the author can remove that note.");
  }

  await db.delete(s.customerNotes).where(eq(s.customerNotes.id, noteId));
  revalidatePath(`/app/customers/${note.customer.id}`);
}

/**
 * Record a consent decision.
 *
 * Written as an upsert with a fresh timestamp: consent is a point-in-time
 * statement, and overwriting the date is the whole reason to store it.
 */
export async function setConsent(customerId: string, kind: string, granted: boolean, detail: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "customers.read", { brandId: brand.id });
  await scoped(customerId, brand.id);

  await db
    .insert(s.customerConsents)
    .values({ customerId, kind, granted, detail: detail || `Set by ${session.name}`, capturedAt: new Date() })
    .onConflictDoUpdate({
      target: [s.customerConsents.customerId, s.customerConsents.kind],
      set: { granted, detail: detail || `Set by ${session.name}`, capturedAt: new Date() },
    });

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: granted ? "consent.granted" : "consent.withdrawn",
    target: customerId,
    meta: { kind },
  });

  revalidatePath(`/app/customers/${customerId}`);
}

/** Assign, or unassign, the person who owns this account. */
export async function assignOwner(customerId: string, owner: string | null) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "customers.read", { brandId: brand.id });
  await scoped(customerId, brand.id);

  await db
    .update(s.customers)
    .set({ owner: owner?.trim() || null })
    .where(eq(s.customers.id, customerId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "customer.owner_changed",
    target: customerId,
    meta: { owner },
  });

  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath("/app/customers");
}

/**
 * The customer table as CSV.
 *
 * Exports whatever the current filters select rather than the whole brand —
 * the point of an export button under a filtered table is the filtered table.
 * Gated on `transcripts.export` because this is the same class of thing: bulk
 * customer data leaving the workspace.
 */
export async function exportCustomersCsv(query: Params): Promise<string> {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "transcripts.export", { brandId: brand.id });

  const axisMinimums: Record<string, number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("axis_")) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) axisMinimums[key.slice(5)] = n;
  }

  const filters: CustomerFilters = {
    q: query.q,
    minScore: intOf(query, "minScore", 0, 0, 100) || undefined,
    axisMinimums,
    segment: listOf(query, "segment"),
    tier: listOf(query, "tier"),
    flag: listOf(query, "flag"),
    lastContact: query.lastContact,
    owner: query.owner,
    sort: query.sort,
    // One page, not the paged slice — an export of page 2 is nobody's intent.
    page: 1,
    pageSize: 5000,
  };

  const { rows, total } = await listCustomers(brand.id, filters);

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "customers.exported",
    target: brand.id,
    meta: { rows: total, filters: query },
  });

  const header = ["Name", "Segment", "Tier", "Priority", "LTV", "Churn", "Sentiment", "Last contact", "Owner", "Flag"];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  return [
    header.join(","),
    ...rows.map((c) =>
      [
        c.name,
        c.segment ?? "",
        c.tier ?? "",
        String(c.priority),
        c.ltv,
        c.churn,
        c.sentiment,
        c.last,
        c.owner,
        c.flag,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

/* ─── One customer, every channel (lib/crm/identity.ts) ────────────────── */

/** Merging joins two people's records: a manager's, an admin's or an owner's call, not an agent's. */
async function canMerge() {
  const ctx = await getConsoleContext();
  assertCan(ctx.session.actor, "customers.read", { brandId: ctx.brand.id });
  if (ctx.session.actor.role === "agent") throw new Error("Merging customers needs a manager, admin or owner.");
  return ctx;
}

/** Fold `fromId` into `intoId`: everything moves, `fromId` goes. */
export async function mergeCustomer(intoId: string, fromId: string) {
  const { session, brand } = await canMerge();
  const [into, from] = await Promise.all([scoped(intoId, brand.id), scoped(fromId, brand.id)]);
  await mergeCustomers(brand.id, from.id, into.id, { reason: `Merged by ${session.name}`, by: session.name, claimed: false });
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "customer.merged",
    target: into.id,
    meta: { from: from.id, fromName: from.name, fromPhone: from.phone, fromEmail: from.email },
  });
  revalidatePath(`/app/customers/${into.id}`);
  revalidatePath("/app/customers");
}

/** Merge in the other record a number or email belongs to. */
export async function mergeByHandle(intoId: string, numberOrEmail: string) {
  const { brand } = await canMerge();
  await scoped(intoId, brand.id);
  const other = await customerForMerge(brand.id, numberOrEmail, intoId);
  if (!other) throw new Error("No other customer has that number or email.");
  await mergeCustomer(intoId, other.id);
  return { merged: other.name };
}

/** "Not the same person": the match stops being suggested. */
export async function dismissMatch(matchId: string) {
  const { session, brand } = await canMerge();
  await db
    .update(s.customerMatches)
    .set({ status: "dismissed", decidedBy: session.name, decidedAt: new Date() })
    .where(and(eq(s.customerMatches.id, matchId), eq(s.customerMatches.brandId, brand.id)));
  revalidatePath("/app/customers");
}

/**
 * Confirm a number or email someone only said: it is theirs. It becomes the
 * one on file if there is none, so details and callbacks can go to it.
 */
export async function confirmHandle(identityId: string) {
  const { session, brand } = await canMerge();
  const [row] = await db
    .update(s.customerIdentities)
    .set({ verified: true })
    .where(and(eq(s.customerIdentities.id, identityId), eq(s.customerIdentities.brandId, brand.id)))
    .returning();
  if (!row) throw new Error("No such number or email.");
  const column = row.kind === "phone" ? "phone" : "email";
  await db.execute(sql`UPDATE customers SET ${sql.raw(column)} = coalesce(${sql.raw(column)}, ${row.display}) WHERE id = ${row.customerId}`);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "customer.handle_confirmed", target: row.customerId, meta: { kind: row.kind } });
  revalidatePath(`/app/customers/${row.customerId}`);
}

/** Take a number or email off a customer — one added by mistake. */
export async function removeCustomerHandle(identityId: string) {
  const { session, brand } = await canMerge();
  const removed = await removeHandle(brand.id, identityId);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "customer.handle_removed", target: removed.customerId, meta: { kind: removed.kind, value: removed.display } });
  revalidatePath(`/app/customers/${removed.customerId}`);
}

/** Undo a merge: the folded-in record comes back with what was its. */
export async function undoCustomerMerge(mergeId: string) {
  const { session, brand } = await canMerge();
  const result = await undoMerge(brand.id, mergeId, session.name);
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "customer.merge_undone", target: result.restored, meta: { mergeId, exact: result.exact, ...result.moved } });
  revalidatePath("/app/customers");
  revalidatePath(`/app/customers/${result.restored}`);
  return result;
}
