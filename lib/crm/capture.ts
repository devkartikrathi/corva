import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { candidatesFor } from "@/lib/agent/routing";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { OPEN_STAGES } from "@/lib/business/industries";
import { phoneDigits } from "@/lib/business/phone";
import {
  attachConversation,
  createCustomer,
  customerByHandle,
  customerForHandle,
  handle,
  isStandIn,
  isVerified,
  keepHandle,
  linkVisitor,
  mergeCustomers,
  recordMatch,
  type HandleSource,
} from "./identity";
import { emit, followUpPayload } from "@/lib/integrations/webhooks";

/**
 * What the AI writes into the CRM while it talks.
 *
 * A helpline that answers well and forgets everything is a cost centre. The
 * point of putting the agent in front of the phone is that every caller leaves
 * a record behind: who they are, what they wanted, who on the team owns it,
 * and what was promised by when. These are the functions the agent's tools
 * call — on voice and on text — so both channels write the same rows.
 *
 * Nothing here asks the model to be careful. Ownership, deduplication and due
 * dates are decided in code.
 */

const PHONE_ONLY = /^\+?[\d\s()-]{7,}$/;

/** A customer the business does not know yet: named after their number. */
export const isUnnamed = (name: string) => PHONE_ONLY.test(name.trim()) || /^(new|unknown) caller/i.test(name);

/**
 * The customer record for whoever is calling.
 *
 * Found by phone number within the business, or created — every caller becomes
 * a contact, named after their number until the agent learns their name.
 * `how` says whether the number is proven (a real call's caller id, WhatsApp,
 * the business's own system) or only what someone typed. See lib/crm/identity.ts.
 */
export async function customerForCaller(
  brandId: string,
  callerPhone: string | null | undefined,
  how: { verified: boolean; source: HandleSource; conversationId?: string | null; name?: string | null } = { verified: false, source: "earlier" },
) {
  const h = handle("phone", callerPhone);
  if (!h) return null;
  const { customer } = await customerForHandle(brandId, h, { ...how, segment: "New caller" });
  return customer;
}

/**
 * Who should own a new lead or follow-up.
 *
 * The account owner if the customer has one; otherwise whoever on the team is
 * carrying the fewest open leads, available people first. Unlike a live
 * handoff this does not need someone free *now* — a lead is worked over days —
 * so an offline person can still be given one.
 */
export async function pickOwner(brandId: string, customerId: string | null) {
  const [brand] = await db.select({ orgId: s.brands.orgId }).from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
  if (!brand) return null;

  if (customerId) {
    const [c] = await db
      .select({ id: s.customers.ownerMembershipId, name: s.memberships.name })
      .from(s.customers)
      .innerJoin(s.memberships, eq(s.memberships.id, s.customers.ownerMembershipId))
      .where(and(eq(s.customers.id, customerId), eq(s.memberships.status, "active")))
      .limit(1);
    if (c?.id) return { membershipId: c.id, name: c.name };
  }

  // Real people only: a test account must never be handed a customer's lead.
  const candidates = (await candidatesFor(brand.orgId, brandId)).filter((c) => !c.isTest);
  if (candidates.length === 0) return null;

  const load = await db
    .select({ owner: s.leads.ownerMembershipId, n: sql<number>`count(*)::int` })
    .from(s.leads)
    .where(and(eq(s.leads.brandId, brandId), inArray(s.leads.stage, OPEN_STAGES)))
    .groupBy(s.leads.ownerMembershipId);
  const loadBy = new Map(load.map((l) => [l.owner, l.n]));

  // Owners and admins last: they can take leads, but a team exists so they
  // do not have to.
  const senior = (role: string) => (role === "owner" || role === "admin" ? 1 : 0);
  const [best] = [...candidates].sort(
    (a, b) =>
      senior(a.role) - senior(b.role) ||
      Number(b.availability === "available") - Number(a.availability === "available") ||
      (loadBy.get(a.membershipId) ?? 0) - (loadBy.get(b.membershipId) ?? 0) ||
      a.name.localeCompare(b.name),
  );
  return best ? { membershipId: best.membershipId, name: best.name } : null;
}

/**
 * Record who the caller is and what they want.
 *
 * One lead per conversation: calling this again during the same call updates
 * it rather than creating a second. A caller who already has an open lead gets
 * that one updated too, so ringing back twice about the same flat does not
 * make two opportunities.
 */
/**
 * Attach the conversation to the customer it is with, from what they said.
 *
 * A phone number decides who someone is: an existing customer with that
 * number is them, whatever name they gave. A name fills in a customer known
 * only by their number, and a name with no customer at all makes one. Every
 * path that learns who it is talking to — the chat's details, a call's saved
 * details, the transcript read after a call — comes through here, so a
 * customer who gave their name is never left "Unidentified".
 */
export async function identifyCustomer(opts: {
  conversationId: string;
  brandId: string;
  customerId?: string | null;
  name?: string;
  phone?: string;
  email?: string;
}) {
  const name = opts.name?.trim();

  // Who the conversation is about *now*. An earlier call in this same
  // conversation may have created or switched the customer, and the id the
  // caller of this function captured when the conversation opened is stale —
  // trusting it made a new customer and a new lead every time the agent
  // saved details on a website call that started anonymous.
  const [conversation] = await db
    .select({ customerId: s.conversations.customerId, identifiedBy: s.conversations.identifiedBy, channel: s.conversations.channel })
    .from(s.conversations)
    .where(eq(s.conversations.id, opts.conversationId))
    .limit(1);
  const currentId = conversation?.customerId ?? opts.customerId;
  let customer = currentId
    ? (await db.select().from(s.customers).where(eq(s.customers.id, currentId)).limit(1))[0]
    : undefined;
  const source: HandleSource =
    conversation?.channel === "whatsapp" ? "whatsapp" : conversation?.channel === "email" ? "email" : conversation?.channel === "phone" ? "voice" : "chat";
  const verifiedHere = isVerified(conversation?.identifiedBy);

  // What the person said about themselves. A phone number first: it decides who someone is.
  for (const h of [handle("phone", opts.phone), handle("email", opts.email)]) {
    if (!h) continue;
    const found = await customerByHandle(opts.brandId, h);

    if (found && found.customer.id === customer?.id) continue;

    if (found && !customer) {
      // An anonymous conversation learns who it is with.
      customer = found.customer;
      await attachConversation(opts.conversationId, customer.id, "stated");
      continue;
    }

    if (found && customer) {
      if (await isStandIn(customer, opts.conversationId)) {
        // The record this conversation made a moment ago is the customer it turned
        // out to be: everything moves across, and the stand-in goes.
        await mergeCustomers(opts.brandId, customer.id, found.customer.id, {
          reason: `Gave ${h.display}, already on this customer, in a conversation`,
          by: "Corva",
          claimed: true,
        });
        customer = found.customer;
        await attachConversation(opts.conversationId, customer.id, "stated");
      } else if (h.kind === "phone" && !verifiedHere) {
        // Someone known only by what was said here — a shared browser, a family
        // member on another's line — gave a number that is someone else's.
        // The number decides: this conversation is with them.
        await recordMatch(opts.brandId, customer.id, found.customer.id, `Gave the number ${h.display} in a conversation that started as the other record`, opts.conversationId);
        customer = found.customer;
        await attachConversation(opts.conversationId, customer.id, "stated");
      } else {
        // Two real customers. A claim never merges them; the team decides.
        await recordMatch(opts.brandId, customer.id, found.customer.id, `Gave ${h.display}, which is on the other record`, opts.conversationId);
      }
      continue;
    }

    if (!customer) {
      customer = await createCustomer(opts.brandId, { name, [h.kind]: h, segment: "New caller", verified: false, source, conversationId: opts.conversationId });
      await attachConversation(opts.conversationId, customer.id, "stated");
      continue;
    }

    // A handle nobody has: theirs now — unless it is a second number on a
    // record that already has one and nothing here proves who is speaking.
    if (h.kind === "phone" && customer.phone && phoneDigits(customer.phone) !== h.value && !verifiedHere && !(await isStandIn(customer, opts.conversationId))) {
      customer = await createCustomer(opts.brandId, { name, phone: h, segment: "New caller", verified: false, source, conversationId: opts.conversationId });
      await attachConversation(opts.conversationId, customer.id, "stated");
      continue;
    }
    // The address on file only from someone we know is them, or on a record made here.
    const trusted = verifiedHere || (await isStandIn(customer, opts.conversationId));
    await keepHandle(customer.id, opts.brandId, h, { verified: false, source, conversationId: opts.conversationId });
    const column = h.kind === "phone" ? "phone" : "email";
    if (trusted && !customer[column]) {
      [customer] = await db.update(s.customers).set({ [column]: h.display }).where(eq(s.customers.id, customer.id)).returning();
    }
  }

  if (customer) {
    // Only ever fill in a name we did not have. Someone saying a different
    // name must not rename a customer we already know.
    if (name && isUnnamed(customer.name)) {
      [customer] = await db.update(s.customers).set({ name }).where(eq(s.customers.id, customer.id)).returning();
    }
    await linkVisitor(opts.conversationId);
  } else if (name) {
    customer = await createCustomer(opts.brandId, { name, segment: "New caller", verified: false, source, conversationId: opts.conversationId });
    await attachConversation(opts.conversationId, customer.id, "stated");
  }

  return customer ?? null;
}

export async function saveCallerDetails(opts: {
  conversationId: string;
  brandId: string;
  customerId: string | null;
  name?: string;
  /** A number the person gave in the conversation — it decides who they are. */
  phone?: string;
  email?: string;
  interest?: string;
  notes?: string;
  valueRupees?: number;
  source: string;
}) {
  const name = opts.name?.trim();
  const email = opts.email?.trim().toLowerCase();
  const customer = await identifyCustomer(opts);

  const [existing] = await db
    .select()
    .from(s.leads)
    .where(
      and(
        eq(s.leads.brandId, opts.brandId),
        // The same person's lead from this conversation, or their open one —
        // never a lead that belongs to whoever the conversation started as.
        customer
          ? sql`${s.leads.customerId} = ${customer.id} and (${s.leads.conversationId} = ${opts.conversationId} or ${s.leads.stage} in ('new','contacted','qualified','proposal'))`
          : and(eq(s.leads.conversationId, opts.conversationId), sql`${s.leads.customerId} is null`),
      ),
    )
    .orderBy(desc(s.leads.createdAt))
    .limit(1);

  const leadName = name ?? customer?.name ?? "Unknown caller";
  const valuePaise = typeof opts.valueRupees === "number" && opts.valueRupees > 0 ? Math.round(opts.valueRupees * 100) : undefined;

  if (existing) {
    const [lead] = await db
      .update(s.leads)
      .set({
        name: name ?? existing.name,
        phone: existing.phone ?? customer?.phone ?? null,
        email: email ?? existing.email,
        interest: opts.interest?.trim() || existing.interest,
        notes: [existing.notes, opts.notes?.trim()].filter(Boolean).join("\n") || null,
        ...(valuePaise ? { valuePaise } : {}),
        customerId: customer?.id ?? existing.customerId,
        updatedAt: new Date(),
      })
      .where(eq(s.leads.id, existing.id))
      .returning();
    const owner = lead.ownerMembershipId
      ? (await db.select({ name: s.memberships.name }).from(s.memberships).where(eq(s.memberships.id, lead.ownerMembershipId)).limit(1))[0]?.name ?? null
      : null;
    return { lead, created: false, ownerName: owner };
  }

  const owner = await pickOwner(opts.brandId, customer?.id ?? null);
  const [lead] = await db
    .insert(s.leads)
    .values({
      brandId: opts.brandId,
      customerId: customer?.id ?? null,
      conversationId: opts.conversationId,
      name: leadName,
      phone: customer?.phone ?? null,
      email: email ?? customer?.email ?? null,
      interest: opts.interest?.trim() ?? "",
      notes: opts.notes?.trim() || null,
      valuePaise: valuePaise ?? null,
      ownerMembershipId: owner?.membershipId ?? null,
      source: opts.source,
      createdByAi: true,
    })
    .returning();

  // The account is theirs now too, so the next call about it rings them.
  if (customer && owner && !customer.ownerMembershipId) {
    await db
      .update(s.customers)
      .set({ ownerMembershipId: owner.membershipId, owner: owner.name })
      .where(eq(s.customers.id, customer.id));
  }

  return { lead, created: true, ownerName: owner?.name ?? null };
}

/**
 * Parse the due time the model gives.
 *
 * The model is told the current date and time and asked for an ISO timestamp;
 * anything it gets wrong — a date in the past, nonsense — becomes "next working
 * morning" rather than an error the caller would hear about.
 */
export function dueFrom(when: string | undefined, now = new Date()): Date {
  const parsed = when ? new Date(when) : null;
  if (parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime() - 60_000) return parsed;
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  // 10:00 IST is 04:30 UTC.
  next.setUTCHours(4, 30, 0, 0);
  return next;
}

/** A promise made on the business's behalf, with a person and a date on it. */
export async function scheduleFollowUp(opts: {
  conversationId: string | null;
  brandId: string;
  customerId: string | null;
  title: string;
  detail?: string;
  due?: string;
  createdByName: string;
  createdByAi: boolean;
  assigneeMembershipId?: string | null;
}) {
  const [lead] = opts.conversationId
    ? await db
        .select({ id: s.leads.id, owner: s.leads.ownerMembershipId })
        .from(s.leads)
        .where(eq(s.leads.conversationId, opts.conversationId))
        .limit(1)
    : [];

  let assignee: { membershipId: string; name: string } | null = null;
  const wanted = opts.assigneeMembershipId ?? lead?.owner ?? null;
  if (wanted) {
    const [m] = await db
      .select({ id: s.memberships.id, name: s.memberships.name })
      .from(s.memberships)
      .where(eq(s.memberships.id, wanted))
      .limit(1);
    if (m) assignee = { membershipId: m.id, name: m.name };
  }
  assignee ??= await pickOwner(opts.brandId, opts.customerId);

  const dueAt = dueFrom(opts.due);
  const [row] = await db
    .insert(s.followUps)
    .values({
      brandId: opts.brandId,
      customerId: opts.customerId,
      leadId: lead?.id ?? null,
      conversationId: opts.conversationId,
      title: opts.title.trim().slice(0, 200) || "Call the customer back",
      detail: opts.detail?.trim() || null,
      dueAt,
      assigneeMembershipId: assignee?.membershipId ?? null,
      createdByName: opts.createdByName,
      createdByAi: opts.createdByAi,
    })
    .returning();
  emit(opts.brandId, "follow_up.created", () => followUpPayload(row.id));

  // Promising a callback is contacting them; a lead still at "new" has moved.
  if (lead) {
    await db
      .update(s.leads)
      .set({ stage: "contacted", stageChangedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(s.leads.id, lead.id), eq(s.leads.stage, "new")));
  }

  return { followUp: row, assigneeName: assignee?.name ?? null, dueAt };
}

/** "Tuesday 30 September, 4:12 pm" in India — what the model needs to set a date. */
export function nowInIndia(now = new Date()) {
  return now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The prompt section both channels share, so the CRM behaviour is one thing. */
export function crmInstructions(opts: { isNewCaller: boolean; leadQuestions: string[]; callbackHours?: string }) {
  return [
    "RECORDING WHAT HAPPENS",
    `It is now ${nowInIndia()} (India time).`,
    opts.isNewCaller
      ? `This caller is not in the records yet. Find out ${opts.leadQuestions.join(", ")} — naturally, one question at a time. As soon as you know their name and what they want, call save_caller_details. Call it again if you learn more (email, budget, details).`
      : "If the caller wants something new — a purchase, booking or service — call save_caller_details with what they want.",
    "Whenever you promise that someone from the team will call back, send something, or check on something, call schedule_follow_up with what was promised and when (an ISO date-time with +05:30, within opening hours). Then tell the caller who will get back to them and roughly when.",
    "If you cannot answer a question from the business's information, offer a callback and schedule it rather than guessing.",
  ].join("\n");
}

/**
 * A new caller who left without a lead or a promise still rang for a reason.
 *
 * The most expensive call for a small business is the one nobody returns:
 * someone new rings, the line drops or they give up before saying who they
 * are, and there is nothing in any list to remind anyone. So when a call from
 * an unknown number ends with no lead and no follow-up on it, one is written —
 * "call them back" — with an owner and a time. A silent call of a few seconds
 * is treated as a misdial and left alone.
 */
export async function followUpIfLost(conversationId: string, seconds: number) {
  const [conv] = await db
    .select({ c: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conv?.customer || conv.c.handledBy) return null;
  if (!isUnnamed(conv.customer.name)) return null;

  const [counts] = await db
    .select({
      leads: sql<number>`(select count(*)::int from ${s.leads} where conversation_id = ${conversationId})`,
      followUps: sql<number>`(select count(*)::int from ${s.followUps} where conversation_id = ${conversationId})`,
      spoke: sql<number>`(select count(*)::int from ${s.turns} where conversation_id = ${conversationId} and speaker = 'customer')`,
    })
    .from(sql`(select 1) as one`);
  if (!counts || counts.leads > 0 || counts.followUps > 0) return null;
  if (counts.spoke === 0 && seconds < 10) return null;

  return scheduleFollowUp({
    conversationId,
    brandId: conv.c.brandId,
    customerId: conv.customer.id,
    title: `Call back ${conv.customer.phone ?? "the caller"} — new caller, left no details`,
    detail:
      counts.spoke > 0
        ? "They spoke to the AI but hung up before saying who they are or what they need."
        : "The call ended before they said anything.",
    // Within the hour: a missed caller is warmest straight away.
    due: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdByName: "Corva",
    createdByAi: true,
  });
}
