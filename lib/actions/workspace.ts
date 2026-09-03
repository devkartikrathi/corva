"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { requireStaff } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { rescoreBrand } from "@/lib/queries/scoring";

/** Publish the draft agent version, retiring the one it replaces. */
export async function publishAgentVersion() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id, publishing: true });

  const [draft] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "draft")))
    .limit(1);
  if (!draft) throw new Error("There is no draft to publish.");

  await db
    .update(s.agentVersions)
    .set({ status: "retired" })
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "live")));

  await db
    .update(s.agentVersions)
    .set({ status: "live", publishedAt: new Date(), authorName: session.name })
    .where(eq(s.agentVersions.id, draft.id));

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "agent_version.published",
    target: `v${draft.version}`,
  });

  revalidatePath("/app/tuning");
}

/** Turn an escalation trigger on or off on the editable version. */
export async function toggleTrigger(triggerId: string, enabled: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  // Only the draft is editable; a live version is a published artefact.
  const [row] = await db
    .select({ trigger: s.escalationTriggers, version: s.agentVersions })
    .from(s.escalationTriggers)
    .innerJoin(s.agentVersions, eq(s.agentVersions.id, s.escalationTriggers.agentVersionId))
    .where(and(eq(s.escalationTriggers.id, triggerId), eq(s.agentVersions.brandId, brand.id)))
    .limit(1);
  if (!row) throw new Error("No such trigger in this brand.");
  if (row.version.status !== "draft") {
    throw new Error("Published versions are immutable — edit the draft instead.");
  }

  await db
    .update(s.escalationTriggers)
    .set({ enabled })
    .where(eq(s.escalationTriggers.id, triggerId));

  revalidatePath("/app/tuning");
}

/** Change one axis weight and recompute every score it touches. */
export async function setAxisWeight(axisKey: string, weight: number) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  const clamped = Math.max(0, Math.min(1, weight));
  await db
    .update(s.brandAxisWeights)
    .set({ weight: clamped })
    .where(
      and(eq(s.brandAxisWeights.brandId, brand.id), eq(s.brandAxisWeights.axisKey, axisKey)),
    );

  // A weight that does not move the queue is a weight nobody trusts.
  await rescoreBrand(brand.id);

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "scoring.weight_changed",
    target: axisKey,
    meta: { weight: clamped },
  });

  revalidatePath("/app/segments");
  revalidatePath("/app/customers");
  revalidatePath("/app");
}

/** Enable or disable a priority rule, then rescore. */
export async function toggleRule(ruleId: string, enabled: boolean) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  await db
    .update(s.priorityRules)
    .set({ enabled })
    .where(and(eq(s.priorityRules.id, ruleId), eq(s.priorityRules.brandId, brand.id)));

  await rescoreBrand(brand.id);

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: enabled ? "rule.enabled" : "rule.disabled",
    target: ruleId,
  });

  revalidatePath("/app/segments");
  revalidatePath("/app");
}

/** Recompute every score for the current brand. */
export async function rescore() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  const n = await rescoreBrand(brand.id);

  revalidatePath("/app");
  revalidatePath("/app/customers");
  return n;
}

/** Draft a document from a recorded knowledge gap. */
export async function draftFromGap(gapId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const [gap] = await db
    .select()
    .from(s.knowledgeGaps)
    .where(and(eq(s.knowledgeGaps.id, gapId), eq(s.knowledgeGaps.brandId, brand.id)))
    .limit(1);
  if (!gap) throw new Error("No such gap in this brand.");
  if (gap.draftDocumentId) return gap.draftDocumentId;

  const [doc] = await db
    .insert(s.documents)
    .values({
      brandId: brand.id,
      collection: "Drafts",
      title: gap.intent,
      kind: "Policy",
      body: "",
      ownerName: session.name,
      // Draft, not published: the AI must not answer from an empty document.
      status: "draft",
    })
    .returning();

  await db
    .update(s.knowledgeGaps)
    .set({ draftDocumentId: doc.id })
    .where(eq(s.knowledgeGaps.id, gapId));

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "document.drafted_from_gap",
    target: gap.intent,
  });

  revalidatePath("/app/knowledge");
  return doc.id;
}

/* ─── Operator ─────────────────────────────────────────────────────────── */

/**
 * Request time-boxed read access to a tenant.
 *
 * This is the only way staff reach tenant content, and it is a row with an
 * expiry that lands in the tenant's own audit log — not a flag on a session.
 */
export async function requestSupportAccess(orgSlug: string, reason: string, minutes = 60) {
  const { staff } = await requireStaff();

  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, orgSlug))
    .limit(1);
  if (!org) throw new Error("No such company.");
  if (!reason.trim()) throw new Error("A reason is required.");

  const [grant] = await db
    .insert(s.supportGrants)
    .values({
      orgId: org.id,
      staffId: staff.staffId,
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + minutes * 60_000),
    })
    .returning();

  // Written to the tenant's log, not ours — that is what makes it visible.
  await db.insert(s.auditLog).values({
    orgId: org.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "support_access.granted",
    target: `${minutes} minutes`,
    meta: { reason: reason.trim() },
  });

  revalidatePath(`/operator/companies/${orgSlug}`);
  return grant.id;
}

/** End a support grant before it expires. */
export async function revokeSupportAccess(grantId: string) {
  const { staff } = await requireStaff();

  const [grant] = await db
    .select()
    .from(s.supportGrants)
    .where(eq(s.supportGrants.id, grantId))
    .limit(1);
  if (!grant) throw new Error("No such grant.");

  await db
    .update(s.supportGrants)
    .set({ revokedAt: new Date() })
    .where(eq(s.supportGrants.id, grantId));

  await db.insert(s.auditLog).values({
    orgId: grant.orgId,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "support_access.revoked",
  });

  revalidatePath("/operator");
}

/** Turn a platform capability on or off for one tenant. */
export async function setOrgFeatureFlag(orgSlug: string, flagKey: string, enabled: boolean) {
  const { staff } = await requireStaff();
  if (!staff.isAdmin) throw new Error("Only platform admins can change feature flags.");

  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, orgSlug))
    .limit(1);
  if (!org) throw new Error("No such company.");

  await db
    .insert(s.orgFeatureFlags)
    .values({ orgId: org.id, flagKey, enabled })
    .onConflictDoUpdate({
      target: [s.orgFeatureFlags.orgId, s.orgFeatureFlags.flagKey],
      set: { enabled },
    });

  await db.insert(s.auditLog).values({
    orgId: org.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
    target: flagKey,
  });

  revalidatePath(`/operator/companies/${orgSlug}`);
}
