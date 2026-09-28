"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { listCustomers, type CustomerFilters } from "@/lib/queries/customers";
import { intOf, listOf, type Params } from "@/lib/params";
import { audit } from "./audit";

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
