"use server";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { isKnownModel, resolveModel } from "@/lib/agent/models";

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

/**
 * Move traffic off the region an incident is about.
 *
 * Addressed by incident rather than by region because that is where the
 * decision is actually made: staff are looking at "voice latency in
 * ap-south-2", not at a list of regions, and a failover that leaves no mark on
 * the incident it was performed for is a change nobody can reconstruct later.
 *
 * This moves *traffic*, not residency. `organizations.region` is where a
 * tenant's data lives and a latency failover is not consent to move it — so
 * the region's state changes and the tenant rows do not.
 */
export async function failOverRegion(incidentId: string) {
  const { staff } = await requireStaff();

  const [incident] = await db
    .select()
    .from(s.incidents)
    .where(eq(s.incidents.id, incidentId))
    .limit(1);
  if (!incident) throw new Error("No such incident.");
  if (incident.resolvedAt) throw new Error("That incident is already resolved.");
  if (!incident.regionKey) throw new Error("That incident is not about a region.");

  const [region] = await db
    .select()
    .from(s.regions)
    .where(eq(s.regions.key, incident.regionKey))
    .limit(1);
  if (!region) throw new Error("That incident names a region that no longer exists.");
  if (region.state === "failed_over") {
    throw new Error(`${region.label} has already been failed over.`);
  }

  // The healthiest region that is actually serving, by the number the incident
  // is about. An edge-only region is not a failover target.
  const [target] = await db
    .select()
    .from(s.regions)
    .where(and(ne(s.regions.key, region.key), eq(s.regions.state, "healthy")))
    .orderBy(asc(s.regions.voiceP95Ms))
    .limit(1);
  if (!target) throw new Error("No healthy region to fail over to.");

  const [{ n: affected }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.organizations)
    .where(eq(s.organizations.region, region.key));

  await db
    .update(s.regions)
    .set({ state: "failed_over" })
    .where(eq(s.regions.key, region.key));

  await db.insert(s.incidentUpdates).values({
    incidentId,
    // Not "resolved": traffic is moved, but the region is still broken and the
    // incident is what tracks getting it back.
    stage: "monitoring",
    body: `Failed over ${region.label} to ${target.label}. ${affected} compan${affected === 1 ? "y" : "ies"} moved.`,
    authorName: staff.name,
  });

  revalidatePath("/operator/reliability");
  revalidatePath("/operator");
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


/* ─── Models ───────────────────────────────────────────────────────────── */

/**
 * Move one brand onto a different model.
 *
 * Staff only, and on purpose: the choice is about what the platform can afford
 * to spend on this tenant today, which is a question about a shared API key
 * and not one a tenant has the information to answer.
 *
 * It takes effect on the next conversation, never on one already running.
 * Conversations pin the model that answered them the same way they pin the
 * agent version, so a call in progress finishes on what it started with and
 * its cost stays priced at those rates.
 *
 * Written to the tenant's own audit log, because the model is the difference
 * between an answer that lands and one that does not, and a customer who asks
 * "why did it get worse on Tuesday" deserves to find the answer themselves.
 */
export async function setBrandModel(orgSlug: string, brandId: string, modelId: string) {
  const { staff } = await requireStaff();

  if (!isKnownModel(modelId)) throw new Error("That is not a model we offer.");

  const [brand] = await db
    .select({ id: s.brands.id, name: s.brands.name, orgId: s.brands.orgId, modelId: s.brands.modelId })
    .from(s.brands)
    .innerJoin(s.organizations, eq(s.organizations.id, s.brands.orgId))
    .where(and(eq(s.brands.id, brandId), eq(s.organizations.slug, orgSlug)))
    .limit(1);
  if (!brand) throw new Error("No such brand.");
  if (brand.modelId === modelId) return;

  await db.update(s.brands).set({ modelId }).where(eq(s.brands.id, brand.id));

  await db.insert(s.auditLog).values({
    orgId: brand.orgId,
    brandId: brand.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "brand.model_changed",
    target: brand.name,
    meta: {
      from: brand.modelId,
      to: modelId,
      fromLabel: resolveModel(brand.modelId).label,
      toLabel: resolveModel(modelId).label,
    },
  });

  revalidatePath(`/operator/companies/${orgSlug}`);
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
