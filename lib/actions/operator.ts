"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Platform operator actions.
 *
 * Everything here is Corva's own staff acting on Corva's own infrastructure —
 * incidents, quality triage, account notes. What is deliberately *not* here is
 * anything that reads tenant content: that goes through `supportGrants` in
 * `workspace.ts`, and the separation is the point.
 *
 * Actions that touch a tenant write an audit row into that tenant's log, so
 * the customer can see what staff did without asking.
 */


/* ─── Incidents ────────────────────────────────────────────────────────── */

const STAGES = ["investigating", "identified", "monitoring", "resolved"] as const;

/**
 * Post an update on an incident.
 *
 * Posting a `resolved` update closes the incident, rather than resolving being
 * a separate button someone forgets to press after writing "all clear".
 */
export async function postIncidentUpdate(
  incidentId: string,
  stage: (typeof STAGES)[number],
  body: string,
) {
  const { staff } = await requireStaff();

  const text = body.trim();
  if (!text) throw new Error("An update needs something in it.");
  if (!STAGES.includes(stage)) throw new Error("That is not an incident stage.");

  const [incident] = await db
    .select()
    .from(s.incidents)
    .where(eq(s.incidents.id, incidentId))
    .limit(1);
  if (!incident) throw new Error("No such incident.");
  if (incident.resolvedAt) throw new Error("That incident is already resolved.");

  await db.insert(s.incidentUpdates).values({
    incidentId,
    stage,
    body: text,
    authorName: staff.name,
  });

  if (stage === "resolved") {
    await db
      .update(s.incidents)
      .set({ resolvedAt: new Date() })
      .where(eq(s.incidents.id, incidentId));
  }

  revalidatePath("/operator/reliability");
  revalidatePath("/operator");
}

export async function openIncident(input: {
  title: string;
  severity: string;
  regionKey: string | null;
  note: string;
}) {
  const { staff } = await requireStaff();

  const title = input.title.trim();
  if (!title) throw new Error("An incident needs a title.");

  const [incident] = await db
    .insert(s.incidents)
    .values({
      title,
      severity: input.severity,
      regionKey: input.regionKey,
      note: input.note.trim(),
      startedAt: new Date(),
    })
    .returning();

  await db.insert(s.incidentUpdates).values({
    incidentId: incident.id,
    stage: "investigating",
    body: input.note.trim() || "Opened.",
    authorName: staff.name,
  });

  revalidatePath("/operator/reliability");
  revalidatePath("/operator");
  return incident.id;
}


/* ─── Quality triage ───────────────────────────────────────────────────── */

/**
 * Move a flagged answer through triage.
 *
 * `owner` is the important field: it decides whether Corva fixes this centrally
 * or the tenant fixes their own documents, and the whole quality screen exists
 * to separate those two piles.
 */
export async function triageQualityFlag(
  flagId: string,
  input: { status: string; owner: string; rootCause: string },
) {
  const { staff } = await requireStaff();

  if (!["open", "triaged", "fixed", "wont_fix"].includes(input.status)) {
    throw new Error("Unknown triage status.");
  }
  if (!["corva", "tenant"].includes(input.owner)) throw new Error("Owner is Corva or the tenant.");

  const [flag] = await db.select().from(s.qualityFlags).where(eq(s.qualityFlags.id, flagId)).limit(1);
  if (!flag) throw new Error("No such flag.");

  await db
    .update(s.qualityFlags)
    .set({
      status: input.status,
      owner: input.owner,
      rootCause: input.rootCause.trim() || flag.rootCause,
      assignedToStaffId: input.status === "open" ? null : staff.staffId,
      resolvedAt: input.status === "fixed" || input.status === "wont_fix" ? new Date() : null,
    })
    .where(eq(s.qualityFlags.id, flagId));

  revalidatePath("/operator/quality");
  return { ok: true };
}

/* ─── Account notes ────────────────────────────────────────────────────── */

export async function addAccountNote(orgSlug: string, kind: string, body: string) {
  const { staff } = await requireStaff();

  const text = body.trim();
  if (!text) throw new Error("A note needs something in it.");

  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, orgSlug))
    .limit(1);
  if (!org) throw new Error("No such company.");

  await db.insert(s.accountNotes).values({
    orgId: org.id,
    staffId: staff.staffId,
    authorName: staff.name,
    kind,
    body: text,
  });

  // Staff notes are internal, so nothing is written to the tenant's audit log:
  // an entry saying "Corva wrote a note about you" with no content is worse
  // than silence.
  revalidatePath(`/operator/companies/${orgSlug}`);
  revalidatePath("/operator");
}


/* ─── Health ───────────────────────────────────────────────────────────── */


/** Staff notes on one company, newest first. */
export async function accountNotes(orgId: string) {
  await requireStaff();
  return db
    .select()
    .from(s.accountNotes)
    .where(eq(s.accountNotes.orgId, orgId))
    .orderBy(desc(s.accountNotes.createdAt));
}
