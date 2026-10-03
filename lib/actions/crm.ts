"use server";

import { and, eq } from "drizzle-orm";
import { emit, leadPayload } from "@/lib/integrations/webhooks";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan, can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { customerForHandle, handle } from "@/lib/crm/identity";
import * as s from "@/lib/db/schema";
import { normaliseStage, type LeadStage } from "@/lib/business/industries";
import { formatPhone, isPlausiblePhone } from "@/lib/business/phone";
import { scheduleFollowUp } from "@/lib/crm/capture";
import { audit } from "./audit";

/**
 * Working the pipeline.
 *
 * Anyone who takes calls can work a lead or tick off a follow-up — that is the
 * job. What differs is *which*: an Agent may only change what is theirs, and
 * handing work to someone else is a Manager's call. Both are checked here, on
 * every write, whatever the screen happened to show.
 */

function refresh() {
  revalidatePath("/app");
  revalidatePath("/app/leads");
  revalidatePath("/app/follow-ups");
  revalidatePath("/app/customers", "layout");
}

async function context() {
  const ctx = await getConsoleContext();
  assertCan(ctx.session.actor, "calls.handle", { brandId: ctx.brand.id });
  // Managers and above see and assign across the business; an Agent works their own.
  const managesAll = can(ctx.session.actor, "customers.read", { brandId: ctx.brand.id }).grant !== "assigned";
  return { ...ctx, managesAll };
}

async function ownLead(leadId: string) {
  const ctx = await context();
  const [lead] = await db
    .select()
    .from(s.leads)
    .where(and(eq(s.leads.id, leadId), eq(s.leads.brandId, ctx.brand.id)))
    .limit(1);
  if (!lead) throw new Error("No such lead in this business.");
  if (!ctx.managesAll && lead.ownerMembershipId !== ctx.session.membershipId) {
    throw new Error("That lead belongs to someone else. Ask a manager to move it to you.");
  }
  return { ctx, lead };
}

async function assertMember(orgId: string, membershipId: string) {
  const [m] = await db
    .select({ id: s.memberships.id, name: s.memberships.name })
    .from(s.memberships)
    .where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active")))
    .limit(1);
  if (!m) throw new Error("That person is not on this team.");
  return m;
}

export async function setLeadStage(leadId: string, requested: string, lostReason?: string) {
  const stage = normaliseStage(requested);
  if (!stage) throw new Error("Unknown stage.");
  const { ctx, lead } = await ownLead(leadId);
  if (lead.stage === stage) return;
  await db
    .update(s.leads)
    .set({
      stage: stage as LeadStage,
      stageChangedAt: new Date(),
      updatedAt: new Date(),
      lostReason: stage === "lost" ? lostReason?.trim() || lead.lostReason : null,
    })
    .where(eq(s.leads.id, leadId));
  await audit({
    orgId: ctx.session.orgId,
    brandId: ctx.brand.id,
    actorId: ctx.session.membershipId,
    actorName: ctx.session.name,
    action: "lead.stage_changed",
    target: lead.name,
    meta: { from: lead.stage, to: stage },
  });
  emit(ctx.brand.id, "lead.updated", () => leadPayload(leadId));
  refresh();
}

export async function assignLead(leadId: string, membershipId: string) {
  const { ctx, lead } = await ownLead(leadId);
  if (!ctx.managesAll) throw new Error("Only a manager can hand a lead to someone else.");
  const member = await assertMember(ctx.session.orgId, membershipId);
  await db
    .update(s.leads)
    .set({ ownerMembershipId: member.id, updatedAt: new Date() })
    .where(eq(s.leads.id, leadId));
  // The open follow-ups on it go with it — work follows the owner.
  await db
    .update(s.followUps)
    .set({ assigneeMembershipId: member.id })
    .where(and(eq(s.followUps.leadId, leadId), eq(s.followUps.status, "open")));
  await audit({
    orgId: ctx.session.orgId,
    brandId: ctx.brand.id,
    actorId: ctx.session.membershipId,
    actorName: ctx.session.name,
    action: "lead.assigned",
    target: lead.name,
    meta: { to: member.name },
  });
  emit(ctx.brand.id, "lead.updated", () => leadPayload(leadId));
  refresh();
}

export async function updateLead(
  leadId: string,
  input: { interest?: string; notes?: string; valueRupees?: number | null; email?: string },
) {
  const { lead } = await ownLead(leadId);
  await db
    .update(s.leads)
    .set({
      interest: input.interest?.trim() ?? lead.interest,
      notes: input.notes === undefined ? lead.notes : input.notes.trim() || null,
      valuePaise:
        input.valueRupees === undefined
          ? lead.valuePaise
          : input.valueRupees === null || input.valueRupees <= 0
            ? null
            : Math.round(input.valueRupees * 100),
      email: input.email?.trim() || lead.email,
      updatedAt: new Date(),
    })
    .where(eq(s.leads.id, leadId));
  emit(lead.brandId, "lead.updated", () => leadPayload(leadId));
  refresh();
}

/** A lead someone took down by hand — a walk-in, a referral, a call to a mobile. */
export async function createLead(input: {
  name: string;
  phone: string;
  interest: string;
  valueRupees?: number | null;
  ownerMembershipId?: string;
}) {
  const ctx = await context();
  const name = input.name.trim();
  if (!name) throw new Error("A lead needs a name.");
  const phone = input.phone.trim();
  if (phone && !isPlausiblePhone(phone)) throw new Error("That phone number does not look right.");

  const ownerId = ctx.managesAll && input.ownerMembershipId ? input.ownerMembershipId : ctx.session.membershipId;
  const member = await assertMember(ctx.session.orgId, ownerId);

  // One person, one record: a phone number already on file is that customer.
  let customerId: string | null = null;
  if (phone) {
    // Someone on the team typed it: a verified handle (lib/crm/identity.ts).
    const found = await customerForHandle(ctx.brand.id, handle("phone", phone)!, { name, segment: "New lead", verified: true, source: "team" });
    customerId = found.customer.id;
    if (found.created) {
      await db.update(s.customers).set({ ownerMembershipId: member.id, owner: member.name }).where(eq(s.customers.id, customerId));
    }
  }

  const [lead] = await db
    .insert(s.leads)
    .values({
      brandId: ctx.brand.id,
      customerId,
      name,
      phone: phone ? formatPhone(phone) : null,
      interest: input.interest.trim(),
      valuePaise: input.valueRupees && input.valueRupees > 0 ? Math.round(input.valueRupees * 100) : null,
      ownerMembershipId: member.id,
      source: "manual",
    })
    .returning();
  await audit({
    orgId: ctx.session.orgId,
    brandId: ctx.brand.id,
    actorId: ctx.session.membershipId,
    actorName: ctx.session.name,
    action: "lead.created",
    target: lead.name,
  });
  emit(ctx.brand.id, "lead.created", () => leadPayload(lead.id));
  refresh();
  return lead.id;
}

/* ─── Follow-ups ───────────────────────────────────────────────────────── */

async function ownFollowUp(followUpId: string) {
  const ctx = await context();
  const [row] = await db
    .select()
    .from(s.followUps)
    .where(and(eq(s.followUps.id, followUpId), eq(s.followUps.brandId, ctx.brand.id)))
    .limit(1);
  if (!row) throw new Error("No such follow-up in this business.");
  if (!ctx.managesAll && row.assigneeMembershipId && row.assigneeMembershipId !== ctx.session.membershipId) {
    throw new Error("That follow-up is someone else's.");
  }
  return { ctx, row };
}

export async function completeFollowUp(followUpId: string, outcome?: string) {
  const { ctx, row } = await ownFollowUp(followUpId);
  if (row.status !== "open") return;
  await db
    .update(s.followUps)
    .set({
      status: "done",
      completedAt: new Date(),
      completedByName: ctx.session.name,
      outcome: outcome?.trim() || null,
      // Whoever did it owns having done it, for the team numbers.
      assigneeMembershipId: row.assigneeMembershipId ?? ctx.session.membershipId,
    })
    .where(eq(s.followUps.id, followUpId));
  refresh();
}

export async function reopenFollowUp(followUpId: string) {
  const { row } = await ownFollowUp(followUpId);
  if (row.status === "open") return;
  await db
    .update(s.followUps)
    .set({ status: "open", completedAt: null, completedByName: null })
    .where(eq(s.followUps.id, followUpId));
  refresh();
}

/** Push a follow-up back by a number of days, keeping its time of day. */
export async function postponeFollowUp(followUpId: string, days = 1) {
  const { row } = await ownFollowUp(followUpId);
  const base = row.dueAt.getTime() < Date.now() ? new Date() : row.dueAt;
  const due = new Date(base.getTime() + days * 864e5);
  await db.update(s.followUps).set({ dueAt: due }).where(eq(s.followUps.id, followUpId));
  refresh();
}

export async function assignFollowUp(followUpId: string, membershipId: string) {
  const { ctx } = await ownFollowUp(followUpId);
  if (!ctx.managesAll && membershipId !== ctx.session.membershipId) {
    throw new Error("Only a manager can hand a follow-up to someone else.");
  }
  const member = await assertMember(ctx.session.orgId, membershipId);
  await db.update(s.followUps).set({ assigneeMembershipId: member.id }).where(eq(s.followUps.id, followUpId));
  refresh();
}

/** A follow-up a person sets themselves, from a lead or a customer. */
export async function addFollowUp(input: {
  title: string;
  due: string;
  customerId?: string | null;
  leadId?: string | null;
  assigneeMembershipId?: string | null;
}) {
  const ctx = await context();
  const title = input.title.trim();
  if (!title) throw new Error("Say what needs doing.");

  let customerId = input.customerId ?? null;
  if (input.leadId) {
    const [lead] = await db
      .select({ customerId: s.leads.customerId })
      .from(s.leads)
      .where(and(eq(s.leads.id, input.leadId), eq(s.leads.brandId, ctx.brand.id)))
      .limit(1);
    if (!lead) throw new Error("No such lead in this business.");
    customerId ??= lead.customerId;
  }
  const assignee =
    input.assigneeMembershipId && ctx.managesAll ? input.assigneeMembershipId : ctx.session.membershipId;

  const { followUp } = await scheduleFollowUp({
    conversationId: null,
    brandId: ctx.brand.id,
    customerId,
    title,
    due: input.due,
    createdByName: ctx.session.name,
    createdByAi: false,
    assigneeMembershipId: assignee,
  });
  if (input.leadId) {
    await db.update(s.followUps).set({ leadId: input.leadId }).where(eq(s.followUps.id, followUp.id));
  }
  refresh();
}
