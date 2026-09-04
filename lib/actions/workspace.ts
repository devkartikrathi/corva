"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { requireStaff } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { generateText } from "ai";
import { loadAgentConfig } from "@/lib/agent/config";
import { checkTriggers } from "@/lib/agent/guardrails";
import { TURN_MODEL, TURN_OPTIONS } from "@/lib/agent/model";
import { systemPrompt } from "@/lib/agent/respond";
import { retrieve } from "@/lib/agent/retrieval";
import { rescoreBrand } from "@/lib/queries/scoring";
import { validateClauses, type Clause } from "@/lib/rules";

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

/* ─── Editing the agent ────────────────────────────────────────────────── */

/**
 * The version edits land on.
 *
 * Never the live one. If there is no draft, one is forked from live — so
 * changing a ceiling can never alter what a call in progress is allowed to do,
 * and every change reaches production through a publish someone pressed.
 */
async function editableVersion(brandId: string, authorName: string) {
  const [draft] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brandId), eq(s.agentVersions.status, "draft")))
    .limit(1);
  if (draft) return draft;

  const [live] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brandId), eq(s.agentVersions.status, "live")))
    .limit(1);
  if (!live) throw new Error("This brand has no agent version to edit.");

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${s.agentVersions.version}), 0)` })
    .from(s.agentVersions)
    .where(eq(s.agentVersions.brandId, brandId));

  const [created] = await db
    .insert(s.agentVersions)
    .values({
      brandId,
      version: Number(max) + 1,
      persona: live.persona,
      tone: live.tone,
      status: "draft",
      authorName,
      notes: `Forked from v${live.version}`,
    })
    .returning();

  // A version without its limits is not a copy of anything; the authority
  // table, triggers and never-rules come with it.
  const [authority, triggers, never] = await Promise.all([
    db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, live.id)),
    db.select().from(s.escalationTriggers).where(eq(s.escalationTriggers.agentVersionId, live.id)),
    db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, live.id)),
  ]);

  if (authority.length) {
    await db.insert(s.authorityLimits).values(
      authority.map((a) => ({
        agentVersionId: created.id,
        action: a.action,
        label: a.label,
        ceilingPence: a.ceilingPence,
        blocked: a.blocked,
        escalateTo: a.escalateTo,
      })),
    );
  }
  if (triggers.length) {
    await db.insert(s.escalationTriggers).values(
      triggers.map((t) => ({
        agentVersionId: created.id,
        description: t.description,
        rule: t.rule,
        enabled: t.enabled,
      })),
    );
  }
  if (never.length) {
    await db.insert(s.neverRules).values(
      never.map((n) => ({ agentVersionId: created.id, description: n.description })),
    );
  }

  return created;
}

/** Rewrite the persona the agent answers with. */
export async function setPersona(persona: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  const text = persona.trim();
  if (text.length < 20) throw new Error("A persona needs more than a sentence to be useful.");

  const version = await editableVersion(brand.id, session.name);
  await db.update(s.agentVersions).set({ persona: text }).where(eq(s.agentVersions.id, version.id));

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "agent.persona_changed",
    target: `v${version.version}`,
  });

  revalidatePath("/app/tuning");
}

/** Move one tone dial on the draft. */
export async function setTone(key: string, value: number) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error("Tone runs 0 to 10.");
  }

  const version = await editableVersion(brand.id, session.name);
  const tone = { ...((version.tone ?? {}) as Record<string, number>), [key]: value };
  await db.update(s.agentVersions).set({ tone }).where(eq(s.agentVersions.id, version.id));

  revalidatePath("/app/tuning");
}

/**
 * Change what the agent may do without asking.
 *
 * The three states are distinct and not interchangeable: a ceiling of nothing
 * means unlimited, blocked means never, and a number means up to that. Passing
 * a ceiling with `blocked` would be ambiguous, so blocking clears it.
 */
export async function setAuthority(
  limitId: string,
  input: { blocked: boolean; ceilingPence: number | null; escalateTo: string | null },
) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  const version = await editableVersion(brand.id, session.name);

  // The id names a row on whichever version the screen was showing; the change
  // is applied to the editable one by action key, so editing while a draft is
  // forked underneath cannot write to the live version.
  const [source] = await db
    .select()
    .from(s.authorityLimits)
    .where(eq(s.authorityLimits.id, limitId))
    .limit(1);
  if (!source) throw new Error("No such authority limit.");

  if (input.ceilingPence !== null && input.ceilingPence < 0) {
    throw new Error("A ceiling cannot be negative.");
  }

  await db
    .update(s.authorityLimits)
    .set({
      blocked: input.blocked,
      ceilingPence: input.blocked ? null : input.ceilingPence,
      escalateTo: input.escalateTo,
    })
    .where(
      and(
        eq(s.authorityLimits.agentVersionId, version.id),
        eq(s.authorityLimits.action, source.action),
      ),
    );

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "authority.changed",
    target: source.action,
    meta: { blocked: input.blocked, ceilingPence: input.ceilingPence },
  });

  revalidatePath("/app/tuning");
  revalidatePath("/app/live");
}

/** Add a line to the never-do list. */
export async function addNeverRule(description: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  const text = description.trim();
  if (!text) throw new Error("A rule needs wording.");

  const version = await editableVersion(brand.id, session.name);
  await db.insert(s.neverRules).values({ agentVersionId: version.id, description: text });

  revalidatePath("/app/tuning");
}

export async function removeNeverRule(ruleId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  const version = await editableVersion(brand.id, session.name);
  const [rule] = await db.select().from(s.neverRules).where(eq(s.neverRules.id, ruleId)).limit(1);
  if (!rule) throw new Error("No such rule.");

  await db
    .delete(s.neverRules)
    .where(
      and(
        eq(s.neverRules.agentVersionId, version.id),
        eq(s.neverRules.description, rule.description),
      ),
    );

  revalidatePath("/app/tuning");
}


/** Throw away the draft and go back to what is live. */
export async function discardDraft() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id, publishing: true });

  const [draft] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "draft")))
    .limit(1);
  if (!draft) throw new Error("There is no draft.");

  await db.delete(s.agentVersions).where(eq(s.agentVersions.id, draft.id));

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "agent_version.discarded",
    target: `v${draft.version}`,
  });

  revalidatePath("/app/tuning");
}

/**
 * Put a retired version back in front of customers.
 *
 * Copies it forward as a new draft rather than flipping the old row to live:
 * "what was answering calls on the 3rd" has to keep its answer, and a version
 * that was live twice cannot say.
 */
export async function rollbackToVersion(versionId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id, publishing: true });

  const [old] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.id, versionId), eq(s.agentVersions.brandId, brand.id)))
    .limit(1);
  if (!old) throw new Error("No such version.");
  if (old.status === "live") throw new Error("That version is already live.");

  await db
    .delete(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "draft")));

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${s.agentVersions.version}), 0)` })
    .from(s.agentVersions)
    .where(eq(s.agentVersions.brandId, brand.id));

  const [created] = await db
    .insert(s.agentVersions)
    .values({
      brandId: brand.id,
      version: Number(max) + 1,
      persona: old.persona,
      tone: old.tone,
      status: "draft",
      authorName: session.name,
      notes: `Rolled back to v${old.version}`,
    })
    .returning();

  const [authority, triggers, never] = await Promise.all([
    db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, old.id)),
    db.select().from(s.escalationTriggers).where(eq(s.escalationTriggers.agentVersionId, old.id)),
    db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, old.id)),
  ]);
  if (authority.length) {
    await db.insert(s.authorityLimits).values(
      authority.map((a) => ({
        agentVersionId: created.id,
        action: a.action,
        label: a.label,
        ceilingPence: a.ceilingPence,
        blocked: a.blocked,
        escalateTo: a.escalateTo,
      })),
    );
  }
  if (triggers.length) {
    await db.insert(s.escalationTriggers).values(
      triggers.map((t) => ({
        agentVersionId: created.id,
        description: t.description,
        rule: t.rule,
        enabled: t.enabled,
      })),
    );
  }
  if (never.length) {
    await db.insert(s.neverRules).values(
      never.map((n) => ({ agentVersionId: created.id, description: n.description })),
    );
  }

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "agent_version.rollback_drafted",
    target: `v${old.version} → v${created.version}`,
  });

  revalidatePath("/app/tuning");
}

/**
 * Ask the draft agent a question without it counting.
 *
 * The test console. It runs the same retrieval and the same system prompt as a
 * real turn against whichever version is being edited, but persists nothing —
 * no turn, no citation, no gap, no handoff. The point is to see what a change
 * does before publishing it, and a test that logged a knowledge gap would
 * quietly corrupt the numbers on the screen next door.
 */
export async function previewReply(message: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "agent.edit", { brandId: brand.id });

  const text = message.trim();
  if (!text) throw new Error("Type something for it to answer.");

  const [draft] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "draft")))
    .limit(1);

  const config = await loadAgentConfig(brand.id, draft?.id);
  if (!config) throw new Error("This brand has no agent version to test.");

  const chunks = await retrieve(brand.id, text);
  const best = chunks[0]?.confidence ?? null;

  // Triggers are checked first here for the same reason they are in a real
  // turn: an escalation that pre-empts generation is the answer.
  const fired = checkTriggers(config, {
    customerUtterances: [text],
    sentiment: null,
    humanRequests: 0,
    priority: null,
    retrievalConfidence: best,
    authorityExceeded: false,
  });

  if (fired.length > 0) {
    return {
      version: config.version,
      escalated: true,
      reason: fired.map((f) => f.detail).join(" "),
      text: "I want to get this right rather than guess, so I'm bringing in a colleague now.",
      citations: [] as { title: string; anchor: string | null; confidence: number }[],
    };
  }

  const result = await generateText({
    model: TURN_MODEL,
    providerOptions: TURN_OPTIONS,
    system: systemPrompt(config, "Test console — no customer record attached.", chunks),
    messages: [{ role: "user" as const, content: text }],
  });

  return {
    version: config.version,
    escalated: false,
    reason: null,
    text: result.text,
    citations: chunks.slice(0, 3).map((c) => ({
      title: c.documentTitle,
      anchor: c.anchor,
      confidence: c.confidence,
    })),
  };
}

/* ─── Priority rules and segments ──────────────────────────────────────── */

export async function createRule(input: {
  name: string;
  effect: number;
  clauses: Clause[];
  actions: string[];
}) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  const name = input.name.trim();
  if (!name) throw new Error("A rule needs a name — it is printed next to every score it moves.");
  if (!Number.isFinite(input.effect) || Math.abs(input.effect) > 50) {
    throw new Error("An override is between −50 and +50 points.");
  }
  validateClauses(input.clauses);

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${s.priorityRules.ordinal}), -1)` })
    .from(s.priorityRules)
    .where(eq(s.priorityRules.brandId, brand.id));

  await db.insert(s.priorityRules).values({
    brandId: brand.id,
    name,
    condition: { all: input.clauses },
    effect: input.effect,
    actions: input.actions.map((kind) => ({ kind })),
    authorName: session.name,
    ordinal: Number(max) + 1,
  });

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "priority_rule.created",
    target: name,
    meta: { effect: input.effect },
  });

  // Rules that never take effect are worse than no rules, so the population is
  // rescored immediately rather than at the next nightly run.
  await rescoreBrand(brand.id);
  revalidatePath("/app/segments");
  revalidatePath("/app/customers");
  revalidatePath("/app");
}

export async function deleteRule(ruleId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  const [rule] = await db
    .select()
    .from(s.priorityRules)
    .where(and(eq(s.priorityRules.id, ruleId), eq(s.priorityRules.brandId, brand.id)))
    .limit(1);
  if (!rule) throw new Error("No such rule in this brand.");

  await db.delete(s.priorityRules).where(eq(s.priorityRules.id, ruleId));

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "priority_rule.deleted",
    target: rule.name,
  });

  await rescoreBrand(brand.id);
  revalidatePath("/app/segments");
  revalidatePath("/app/customers");
  revalidatePath("/app");
}



/** Mark a model alert as read, so the panel is a queue and not a wall. */
export async function acknowledgeAlert(alertId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  const [alert] = await db
    .select()
    .from(s.modelAlerts)
    .where(and(eq(s.modelAlerts.id, alertId), eq(s.modelAlerts.brandId, brand.id)))
    .limit(1);
  if (!alert) throw new Error("No such alert.");

  await db
    .update(s.modelAlerts)
    .set({ status: "acknowledged", acknowledgedByName: session.name, acknowledgedAt: new Date() })
    .where(eq(s.modelAlerts.id, alertId));

  revalidatePath("/app/segments");
}

/* ─── Saved views ──────────────────────────────────────────────────────── */

/**
 * Save the current filter set as a named view.
 *
 * A view is nothing more than a stored copy of the screen's query string, so
 * opening one and hand-editing the address bar reach the same code. That is the
 * whole design: there is no privileged filtering path a saved view can use that
 * a URL cannot.
 */
export async function saveView(surface: string, name: string, query: Record<string, string>) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "customers.read", { brandId: brand.id });

  const label = name.trim();
  if (!label) throw new Error("A view needs a name.");
  if (!["customers", "conversations"].includes(surface)) throw new Error("Unknown surface.");

  const [existing] = await db
    .select()
    .from(s.savedViews)
    .where(
      and(
        eq(s.savedViews.orgId, session.orgId),
        eq(s.savedViews.surface, surface),
        eq(s.savedViews.name, label),
      ),
    )
    .limit(1);
  if (existing) throw new Error(`A view called "${label}" already exists.`);

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${s.savedViews.ordinal}), -1)` })
    .from(s.savedViews)
    .where(and(eq(s.savedViews.orgId, session.orgId), eq(s.savedViews.surface, surface)));

  // Shared by default: a filter worth naming is usually worth a colleague
  // seeing, and the alternative is everyone rebuilding the same one.
  await db.insert(s.savedViews).values({
    orgId: session.orgId,
    membershipId: null,
    surface,
    name: label,
    query,
    ordinal: Number(max) + 1,
  });

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "view.saved",
    target: label,
    meta: { surface, query },
  });

  revalidatePath(surface === "customers" ? "/app/customers" : "/app/conversations");
}

export async function deleteView(viewId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "customers.read", { brandId: brand.id });

  const [view] = await db
    .select()
    .from(s.savedViews)
    .where(and(eq(s.savedViews.id, viewId), eq(s.savedViews.orgId, session.orgId)))
    .limit(1);
  if (!view) throw new Error("No such view.");
  if (view.isDefault) throw new Error("The default view cannot be removed.");

  await db.delete(s.savedViews).where(eq(s.savedViews.id, viewId));
  revalidatePath(view.surface === "customers" ? "/app/customers" : "/app/conversations");
}

/* ─── Scoring model ────────────────────────────────────────────────────── */

/**
 * Change how much an axis counts.
 *
 * Rescoring immediately is the point: a weight that does not move the queue
 * until some nightly job runs is a control nobody can learn from. The cost is
 * one pass over the brand's customers, which is bounded and fast.
 */
export async function setAxisWeight(axisKey: string, weight: number) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "scoring.edit", { brandId: brand.id });

  if (!Number.isFinite(weight) || weight < 0 || weight > 2) {
    throw new Error("A weight runs from 0 to 2.");
  }

  const [axis] = await db.select().from(s.scoringAxes).where(eq(s.scoringAxes.key, axisKey)).limit(1);
  if (!axis) throw new Error("No such scoring axis.");

  await db
    .insert(s.brandAxisWeights)
    .values({ brandId: brand.id, axisKey, weight })
    .onConflictDoUpdate({
      target: [s.brandAxisWeights.brandId, s.brandAxisWeights.axisKey],
      set: { weight },
    });

  await db.insert(s.auditLog).values({
    orgId: session.orgId,
    brandId: brand.id,
    actorType: "user",
    actorId: session.membershipId,
    actorName: session.name,
    action: "scoring.weight_changed",
    target: axis.label,
    meta: { weight },
  });

  await rescoreBrand(brand.id);
  revalidatePath("/app/segments");
  revalidatePath("/app/customers");
  revalidatePath("/app");
}
