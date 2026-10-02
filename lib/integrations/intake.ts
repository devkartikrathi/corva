import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatPhone, isPlausiblePhone } from "@/lib/business/phone";
import { OPEN_STAGES, industryFor } from "@/lib/business/industries";
import { customerForCaller, isUnnamed, pickOwner, scheduleFollowUp } from "@/lib/crm/capture";
import { APP_URL, layout, sendEmail } from "@/lib/email";
import { ApiError } from "./api";

/**
 * What a business's website sends Corva, turned into records.
 *
 * Three kinds of thing arrive: a visitor moving around the site (only in
 * detail when they consented), a chat with the site's assistant (mirrored so
 * the team can read it), and a request — a pickup, a callback — which is the
 * moment an anonymous visitor becomes a customer with a lead, an owner, a
 * follow-up and a confirmation in their inbox.
 */

type Brand = typeof s.brands.$inferSelect;

/* ─── Visitors ─────────────────────────────────────────────────────────── */

export type VisitorInput = {
  visitorId: string;
  /** "all" when they accepted analytics cookies; "necessary" otherwise. */
  consent?: "necessary" | "all";
  type?: string;
  path?: string;
  referrer?: string;
  utm?: Record<string, string>;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

/**
 * Note a visitor, and — only with analytics consent — where they have been.
 *
 * Without consent the row still exists (the visitor id is what keeps a chat
 * together across pages, a strictly necessary cookie), but no path, referrer
 * or campaign is kept, and page views are not counted.
 */
export async function recordVisit(brand: Brand, input: VisitorInput) {
  const externalId = clip(input.visitorId, 80);
  if (!externalId || !/^[\w-]{8,80}$/.test(externalId)) throw new Error("A visitor id is required.");
  const analytics = input.consent === "all";
  const type = clip(input.type, 40) ?? "page_view";
  if (type === "page_view" && !analytics) {
    // Nothing to record about a page view without consent, beyond "seen".
    await upsertVisitor(brand.id, externalId, { consent: "necessary" });
    return { recorded: false };
  }
  const visitor = await upsertVisitor(brand.id, externalId, {
    consent: analytics ? "all" : "necessary",
    path: analytics ? clip(input.path, 300) : undefined,
    referrer: analytics ? clip(input.referrer, 300) : undefined,
    utm: analytics && input.utm ? Object.fromEntries(Object.entries(input.utm).slice(0, 6).map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 120)])) : undefined,
    countPage: type === "page_view",
  });
  await db.insert(s.visitorEvents).values({
    visitorId: visitor.id,
    type,
    path: analytics ? clip(input.path, 300) ?? null : null,
  });
  return { recorded: true };
}

async function upsertVisitor(
  brandId: string,
  externalId: string,
  opts: { consent: "necessary" | "all"; path?: string; referrer?: string; utm?: Record<string, string>; countPage?: boolean; customerId?: string },
) {
  const [row] = await db
    .insert(s.visitors)
    .values({
      brandId,
      externalId,
      consent: opts.consent,
      pageViews: opts.countPage ? 1 : 0,
      firstReferrer: opts.referrer ?? null,
      firstUtm: opts.utm ?? {},
      lastPath: opts.path ?? null,
      customerId: opts.customerId ?? null,
    })
    .onConflictDoUpdate({
      target: [s.visitors.brandId, s.visitors.externalId],
      set: {
        consent: opts.consent,
        lastSeenAt: new Date(),
        ...(opts.countPage ? { pageViews: sql`${s.visitors.pageViews} + 1` } : {}),
        ...(opts.path ? { lastPath: opts.path } : {}),
        // "First" means first *consented*: a visit before the banner was
        // answered kept nothing, so the first one after it fills these in.
        ...(opts.referrer ? { firstReferrer: sql`coalesce(${s.visitors.firstReferrer}, ${opts.referrer})` } : {}),
        ...(opts.utm && Object.keys(opts.utm).length
          ? { firstUtm: sql`case when ${s.visitors.firstUtm} = '{}'::jsonb then ${JSON.stringify(opts.utm)}::jsonb else ${s.visitors.firstUtm} end` }
          : {}),
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
        // Withdrawing consent forgets what was only kept because of it.
        ...(opts.consent === "necessary" ? { firstReferrer: null, firstUtm: {}, lastPath: null } : {}),
      },
    })
    .returning();
  return row;
}

/* ─── Conversations from the site's chat ───────────────────────────────── */

export type ChatSyncInput = {
  sessionId: string;
  visitorId?: string;
  messages: { role: "user" | "assistant"; text: string }[];
};

/**
 * Mirror a website chat into Corva.
 *
 * The site's assistant runs on the site; Corva keeps the transcript, so the
 * team sees every chat on the live console and in the archive, and a request
 * made in it links back to what was said. Idempotent: the whole transcript is
 * sent each time, and replaces what was there.
 */
export async function syncChat(brand: Brand, input: ChatSyncInput) {
  const ref = clip(input.sessionId, 80);
  if (!ref) throw new Error("A chat session id is required.");
  const messages = (input.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-80)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

  const visitor = input.visitorId ? await findVisitor(brand.id, input.visitorId) : null;
  const conversation = await conversationFor(brand, `chat:${ref}`, visitor?.customerId ?? null);

  await db.delete(s.turns).where(eq(s.turns.conversationId, conversation.id));
  if (messages.length) {
    await db.insert(s.turns).values(
      messages.map((m, i) => ({
        conversationId: conversation.id,
        ordinal: i,
        speaker: m.role === "user" ? ("customer" as const) : ("ai" as const),
        body: m.text,
        atSeconds: 0,
      })),
    );
  }
  await db
    .update(s.conversations)
    .set({ status: conversation.status === "resolved" ? "resolved" : "live", startedAt: conversation.startedAt })
    .where(eq(s.conversations.id, conversation.id));

  if (visitor && messages.length === 1) {
    await db.insert(s.visitorEvents).values({ visitorId: visitor.id, type: "chat_started" });
  }
  return { conversationId: conversation.id, turns: messages.length };
}

async function findVisitor(brandId: string, externalId: string) {
  const [v] = await db
    .select()
    .from(s.visitors)
    .where(and(eq(s.visitors.brandId, brandId), eq(s.visitors.externalId, externalId)))
    .limit(1);
  return v ?? null;
}

async function conversationFor(brand: Brand, externalRef: string, customerId: string | null) {
  const [existing] = await db
    .select()
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brand.id), eq(s.conversations.externalRef, externalRef)))
    .limit(1);
  if (existing) {
    if (customerId && !existing.customerId) {
      await db.update(s.conversations).set({ customerId }).where(eq(s.conversations.id, existing.id));
    }
    return existing;
  }
  const [version] = await db
    .select({ id: s.agentVersions.id })
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "live")))
    .limit(1);
  const [created] = await db
    .insert(s.conversations)
    .values({
      brandId: brand.id,
      customerId,
      channel: "web_chat",
      status: "live",
      externalRef,
      agentVersionId: version?.id ?? null,
      startedAt: new Date(),
    })
    .returning();
  return created;
}

/* ─── Requests: pickups and callbacks ──────────────────────────────────── */

export type LeadInput = {
  kind: "pickup" | "callback" | "enquiry";
  name: string;
  phone: string;
  email?: string;
  /** The site's own reference, if it made one (e.g. "TD-7K3QX9"). */
  reference?: string;
  services?: string[];
  address?: string;
  pickupDate?: string;
  timeSlot?: string;
  preferredTime?: string;
  topic?: string;
  notes?: string;
  promoCode?: string;
  visitorId?: string;
  sessionId?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reference(prefix: string) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

/** "Laundry, Dry-cleaning · pickup Sat 4 Oct, 8–10 AM · Sector 70" */
function describeRequest(input: LeadInput) {
  if (input.kind === "pickup") {
    return [
      input.services?.length ? input.services.join(", ") : "Pickup",
      [input.pickupDate && `pickup ${input.pickupDate}`, input.timeSlot].filter(Boolean).join(", "),
      input.address,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [input.topic || "Wants a call back", input.preferredTime && `prefers ${input.preferredTime}`].filter(Boolean).join(" · ");
}

/**
 * A request from the website, as records the team works from.
 *
 * Customer by phone number (created if new, named and emailed if we did not
 * know them), a lead with an owner, a follow-up with a time, the chat it came
 * from, and two emails: a confirmation to the customer and a heads-up to
 * whoever now owns it. Emails are best-effort; the records are not.
 */
export async function intakeLead(
  brand: Brand,
  input: LeadInput,
  /** The agent's own chat it came from, when Corva's agent took the request. */
  from?: { conversationId: string },
) {
  const name = clip(input.name, 120)?.trim() ?? "";
  if (name.length < 2) throw new Error("A name is required.");
  if (!isPlausiblePhone(input.phone ?? "")) throw new Error("A valid phone number is required.");
  const email = input.email?.trim().toLowerCase();
  if (email && !EMAIL.test(email)) throw new Error("That email address does not look right.");
  const kind = input.kind === "pickup" || input.kind === "callback" ? input.kind : "enquiry";
  const ref = clip(input.reference, 40) ?? reference(brand.initials.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "CV");
  const industry = industryFor(brand.industry);

  // Idempotent on the site's reference: a retry after a timeout must not make
  // a second lead, a second follow-up and a second email.
  if (input.reference) {
    const [seen] = await db
      .select({ followUp: s.followUps, assignee: s.memberships.name, lead: s.leads })
      .from(s.followUps)
      .leftJoin(s.memberships, eq(s.memberships.id, s.followUps.assigneeMembershipId))
      .leftJoin(s.leads, eq(s.leads.id, s.followUps.leadId))
      .where(
        and(
          eq(s.followUps.brandId, brand.id),
          sql`${s.followUps.detail} like ${`%Ref ${ref}%`}`,
          sql`${s.followUps.createdAt} > now() - interval '7 days'`,
        ),
      )
      .limit(1);
    if (seen) {
      return {
        reference: ref,
        customerId: seen.followUp.customerId,
        leadId: seen.lead?.id ?? null,
        followUp: { id: seen.followUp.id, assignee: seen.assignee, dueAt: seen.followUp.dueAt.toISOString() },
        emailed: { customer: false, team: false },
        duplicate: true,
      };
    }
  }

  // The person.
  let customer = (await customerForCaller(brand.id, input.phone))!;
  const updates: Partial<typeof s.customers.$inferInsert> = {};
  if (isUnnamed(customer.name) || customer.segment === "New caller") updates.name = name;
  if (email && !customer.email) updates.email = email;
  if (input.address && !customer.location) updates.location = clip(input.address, 200);
  if (Object.keys(updates).length) {
    [customer] = await db.update(s.customers).set(updates).where(eq(s.customers.id, customer.id)).returning();
  }

  // Where they came from, now that we know who they are.
  const visitorId = clip(input.visitorId, 80);
  if (visitorId) {
    const existing = await findVisitor(brand.id, visitorId);
    const visitor = await upsertVisitor(brand.id, visitorId, {
      consent: (existing?.consent as "necessary" | "all") ?? "necessary",
      customerId: customer.id,
    });
    await db.insert(s.visitorEvents).values({
      visitorId: visitor.id,
      type: kind === "pickup" ? "pickup_requested" : kind === "callback" ? "callback_requested" : "enquiry",
      meta: { reference: ref },
    });
  }

  // The chat it came from, if any.
  const conversation = from
    ? { id: from.conversationId }
    : input.sessionId
      ? await conversationFor(brand, `chat:${clip(input.sessionId, 80)}`, customer.id)
      : null;
  if (from) {
    await db
      .update(s.conversations)
      .set({ customerId: customer.id })
      .where(and(eq(s.conversations.id, from.conversationId), sql`${s.conversations.customerId} is null`));
  }
  const fromChat = Boolean(from || input.sessionId);

  // The opportunity: reuse an open one rather than stacking duplicates.
  const interest = describeRequest(input).slice(0, 300);
  const notes = [input.notes, input.promoCode && `Promo code ${input.promoCode}`, `Ref ${ref}`].filter(Boolean).join(" · ");
  const [open] = await db
    .select()
    .from(s.leads)
    .where(and(eq(s.leads.brandId, brand.id), eq(s.leads.customerId, customer.id), inArray(s.leads.stage, OPEN_STAGES)))
    .orderBy(desc(s.leads.createdAt))
    .limit(1);

  let lead: typeof s.leads.$inferSelect;
  if (open) {
    [lead] = await db
      .update(s.leads)
      .set({
        interest,
        notes: [open.notes, notes].filter(Boolean).join("\n"),
        email: email ?? open.email,
        conversationId: open.conversationId ?? conversation?.id ?? null,
        ...(kind === "pickup" && (open.stage === "new" || open.stage === "contacted") ? { stage: "qualified" as const, stageChangedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.leads.id, open.id))
      .returning();
  } else {
    const owner = await pickOwner(brand.id, customer.id);
    [lead] = await db
      .insert(s.leads)
      .values({
        brandId: brand.id,
        customerId: customer.id,
        conversationId: conversation?.id ?? null,
        name,
        phone: formatPhone(input.phone),
        email: email ?? null,
        interest,
        notes,
        // A booked pickup is further along than a request to talk.
        stage: kind === "pickup" ? "qualified" : "new",
        ownerMembershipId: owner?.membershipId ?? null,
        source: fromChat ? "web_chat" : "website",
        createdByAi: fromChat,
      })
      .returning();
    if (owner && !customer.ownerMembershipId) {
      await db.update(s.customers).set({ ownerMembershipId: owner.membershipId, owner: owner.name }).where(eq(s.customers.id, customer.id));
    }
  }

  // The promise, with a person and a time. A callback within half an hour;
  // a pickup confirmed within the hour.
  const { followUp, assigneeName, dueAt } = await scheduleFollowUp({
    conversationId: conversation?.id ?? null,
    brandId: brand.id,
    customerId: customer.id,
    title:
      kind === "pickup"
        ? `Confirm pickup with ${name}${input.pickupDate ? ` for ${input.pickupDate}` : ""}${input.timeSlot ? `, ${input.timeSlot}` : ""}`
        : `Call back ${name}${input.topic ? ` about ${input.topic}` : ""}`,
    detail: [interest, input.preferredTime && `Asked for: ${input.preferredTime}`, `Ref ${ref}`].filter(Boolean).join("\n"),
    due: new Date(Date.now() + (kind === "pickup" ? 60 : 30) * 60_000).toISOString(),
    createdByName: brand.agentName ?? "Website",
    createdByAi: fromChat,
    assigneeMembershipId: lead.ownerMembershipId,
  });
  await db.update(s.followUps).set({ leadId: lead.id }).where(eq(s.followUps.id, followUp.id));

  // The emails.
  const when = dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", hour: "numeric", minute: "2-digit" });
  const [customerMail, teamMail] = await Promise.all([
    email
      ? sendEmail({
          to: email,
          fromName: brand.name,
          ...confirmationEmail({ brandName: brand.name, name, kind, ref, interest, preferredTime: input.preferredTime }),
        })
      : Promise.resolve({ sent: false, reason: "No email address given." }),
    notifyOwner(brand, lead.ownerMembershipId, {
      subject: `New ${kind === "pickup" ? "pickup" : kind === "callback" ? "callback request" : "enquiry"}: ${name}`,
      heading: `${name} ${kind === "pickup" ? "booked a pickup" : kind === "callback" ? "wants a call back" : "got in touch"}`,
      lines: [
        interest,
        `Phone: ${formatPhone(input.phone)}${email ? ` · Email: ${email}` : ""}`,
        `It's on your follow-ups for ${when}. Reference ${ref}.`,
        `Stage: ${industry.stages[lead.stage]}`,
      ],
      href: `${APP_URL}/app/customers/${customer.id}`,
    }),
  ]);

  return {
    reference: ref,
    customerId: customer.id,
    leadId: lead.id,
    followUp: { id: followUp.id, assignee: assigneeName, dueAt: dueAt.toISOString() },
    emailed: { customer: customerMail.sent, team: teamMail.sent },
    duplicate: false,
  };
}

function confirmationEmail(opts: {
  brandName: string;
  name: string;
  kind: LeadInput["kind"];
  ref: string;
  interest: string;
  preferredTime?: string;
}) {
  const first = opts.name.split(/\s+/)[0];
  if (opts.kind === "pickup") {
    return {
      subject: `Your pickup request with ${opts.brandName} (${opts.ref})`,
      ...layout({
        heading: `Thanks, ${first} — your pickup is requested`,
        lines: [
          opts.interest,
          "Our team will call you shortly to confirm the slot. Keep this reference handy:",
          opts.ref,
        ],
        footer: `${opts.brandName} · reply to this email if anything changes.`,
      }),
    };
  }
  return {
    subject: `We'll call you back — ${opts.brandName} (${opts.ref})`,
    ...layout({
      heading: `Thanks, ${first} — we'll call you back`,
      lines: [
        `Someone from ${opts.brandName} will call you${opts.preferredTime ? ` (${opts.preferredTime})` : " shortly"}.`,
        opts.interest,
        `Your reference: ${opts.ref}`,
      ],
      footer: `${opts.brandName} · reply to this email if you'd like to add anything.`,
    }),
  };
}

/** Tell whoever owns a lead that it arrived; the Owner if nobody does. */
async function notifyOwner(
  brand: Brand,
  membershipId: string | null,
  mail: { subject: string; heading: string; lines: string[]; href: string },
) {
  const [person] = membershipId
    ? await db.select().from(s.memberships).where(eq(s.memberships.id, membershipId)).limit(1)
    : await db
        .select()
        .from(s.memberships)
        .where(and(eq(s.memberships.orgId, brand.orgId), eq(s.memberships.role, "owner")))
        .limit(1);
  if (!person?.email) return { sent: false, reason: "Nobody to notify." };
  return sendEmail({
    to: person.email,
    subject: mail.subject,
    ...layout({ heading: mail.heading, lines: mail.lines, button: { label: "Open in Corva", href: mail.href } }),
  });
}

/* ─── Corva's own agent, over the API ──────────────────────────────────── */

export type AgentChatInput = {
  sessionId: string;
  message: string;
  visitorId?: string;
  /** Whatever the site already knows about the person, so the agent does too. */
  customer?: { name?: string; phone?: string; email?: string };
  /** Answer as server-sent events, so the reply can be shown as it is written. */
  stream?: boolean;
};

/**
 * One turn with the business's Corva agent, for a site that does not run its
 * own AI.
 *
 * The same `respond()` that answers web chat and the console: grounded in the
 * business's knowledge, bound by its limits, and writing leads, follow-ups
 * and handoffs as it goes. One conversation per `sessionId`, kept separate
 * from mirrored transcripts (`chat:`), because this one Corva is having.
 */
export async function agentChat(brand: Brand, input: AgentChatInput) {
  const session = clip(input.sessionId, 80);
  if (!session || !/^[\w-]{6,80}$/.test(session)) throw new Error("A sessionId (6–80 letters, digits, - or _) is required.");
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("A message is required.");
  if (message.length > 2000) throw new Error("That message is too long (2,000 characters at most).");

  // Who it is, if the site knows.
  let customerId: string | null = null;
  const phone = input.customer?.phone;
  if (phone && isPlausiblePhone(phone)) {
    let customer = (await customerForCaller(brand.id, phone))!;
    const name = input.customer?.name?.trim();
    const email = input.customer?.email?.trim().toLowerCase();
    const updates: Partial<typeof s.customers.$inferInsert> = {};
    if (name && name.length > 1 && isUnnamed(customer.name)) updates.name = name.slice(0, 120);
    if (email && EMAIL.test(email) && !customer.email) updates.email = email;
    if (Object.keys(updates).length) {
      [customer] = await db.update(s.customers).set(updates).where(eq(s.customers.id, customer.id)).returning();
    }
    customerId = customer.id;
  }

  const visitorId = clip(input.visitorId, 80);
  let visitor = visitorId ? await findVisitor(brand.id, visitorId) : null;
  if (!customerId && visitor?.customerId) customerId = visitor.customerId;

  const conversation = await conversationFor(brand, `agent:${session}`, customerId);
  if (conversation.status === "resolved" || conversation.status === "abandoned") {
    throw new ApiError(409, "This conversation has ended. Start a new sessionId.");
  }
  if (visitorId && !visitor) {
    visitor = await upsertVisitor(brand.id, visitorId, { consent: "necessary", customerId: customerId ?? undefined });
  }

  // A person has taken over: record what the customer said, and let them reply.
  if (conversation.handledBy) {
    const [last] = await db
      .select({ ordinal: s.turns.ordinal })
      .from(s.turns)
      .where(eq(s.turns.conversationId, conversation.id))
      .orderBy(desc(s.turns.ordinal))
      .limit(1);
    await db.insert(s.turns).values({
      conversationId: conversation.id,
      ordinal: (last?.ordinal ?? -1) + 1,
      speaker: "customer",
      body: message,
    });
    const held = { conversationId: conversation.id, reply: null, heldBy: conversation.handledBy, actions: [], escalation: null, closed: false, proposal: null };
    if (!input.stream) return held;
    return new Response(`event: done\ndata: ${JSON.stringify(held)}\n\n`, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // Typing instead of tapping answers the card too: whatever they say next is
  // what the agent works from, so the old card can no longer be confirmed.
  await db
    .update(s.chatProposals)
    .set({ status: "superseded", decidedAt: new Date() })
    .where(and(eq(s.chatProposals.conversationId, conversation.id), eq(s.chatProposals.status, "pending")));

  const { respond, respondStream } = await import("@/lib/agent/respond");
  const turn = { conversationId: conversation.id, message, webChat: true };

  if (!input.stream) return publicReply(conversation.id, await respond(turn));

  // Server-sent events: `delta` as the words arrive, `proposal` when a card
  // should show, and `done` with the same body the JSON answer has.
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const event of respondStream(turn)) {
          if (event.type === "delta") send("delta", { text: event.text });
          else if (event.type === "proposal") send("proposal", event.proposal);
          else if (event.type === "done") send("done", publicReply(conversation.id, event.reply));
        }
      } catch (e) {
        console.error("[api] chat stream", e);
        send("error", { error: "Something went wrong." });
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

/** One agent turn as the API reports it. */
function publicReply(conversationId: string, reply: import("@/lib/agent/respond").AgentReply) {
  return {
    conversationId,
    reply: reply.text,
    heldBy: null,
    actions: reply.actions,
    escalation: reply.escalation ? { reason: reply.escalation.reason, routedTo: reply.escalation.routedTo } : null,
    closed: Boolean(reply.closure),
    proposal: reply.proposal,
  };
}

async function addTurns(conversationId: string, turns: { speaker: "customer" | "ai"; body: string }[]) {
  const [last] = await db
    .select({ ordinal: s.turns.ordinal })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(desc(s.turns.ordinal))
    .limit(1);
  const start = (last?.ordinal ?? -1) + 1;
  await db.insert(s.turns).values(turns.map((t, i) => ({ conversationId, ordinal: start + i, ...t })));
}

export type AgentChatConfirmInput = {
  sessionId: string;
  proposalId: string;
  /** True for Confirm, false for Edit. */
  approved: boolean;
  visitorId?: string;
};

/**
 * The customer's answer to a card: Confirm makes the booking or callback —
 * customer, lead, owner, follow-up, emails — and Edit hands the conversation
 * back to the agent to change the details.
 *
 * Safe to repeat: confirming a card twice returns the first result.
 */
export async function agentChatConfirm(brand: Brand, input: AgentChatConfirmInput) {
  const session = clip(input.sessionId, 80);
  if (!session || !/^[\w-]{6,80}$/.test(session)) throw new Error("A sessionId (6–80 letters, digits, - or _) is required.");
  if (!/^[0-9a-f-]{36}$/i.test(String(input.proposalId ?? ""))) throw new Error("A proposalId is required.");
  if (typeof input.approved !== "boolean") throw new Error("approved (true or false) is required.");

  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brand.id), eq(s.conversations.externalRef, `agent:${session}`)))
    .limit(1);
  if (!conversation) throw new ApiError(404, "No conversation with that sessionId.");
  const [proposal] = await db
    .select()
    .from(s.chatProposals)
    .where(and(eq(s.chatProposals.id, input.proposalId), eq(s.chatProposals.conversationId, conversation.id)))
    .limit(1);
  if (!proposal) throw new ApiError(404, "No such card in this conversation.");

  type Receipt = { reference: string; owner: string | null; emailed: boolean };
  if (proposal.status === "confirmed") {
    return { conversationId: conversation.id, reply: null, proposal: { id: proposal.id, status: "confirmed" }, receipt: proposal.result as Receipt, duplicate: true };
  }
  if (proposal.status !== "pending") throw new ApiError(409, "That card is out of date — the details changed after it was shown.");

  const booking = industryFor(brand.industry).booking;
  const noun = proposal.kind === "booking" ? (booking?.noun ?? "booking") : "callback";

  if (!input.approved) {
    await db.update(s.chatProposals).set({ status: "declined", decidedAt: new Date() }).where(eq(s.chatProposals.id, proposal.id));
    const reply = "Of course — what would you like to change?";
    await addTurns(conversation.id, [
      { speaker: "customer", body: `(Chose to edit the ${noun} details.)` },
      { speaker: "ai", body: reply },
    ]);
    return { conversationId: conversation.id, reply, proposal: { id: proposal.id, status: "declined" }, receipt: null, duplicate: false };
  }

  // Checked again: a card left open overnight can have a date in the past.
  const { checkBooking, checkCallback } = await import("@/lib/agent/proposals");
  type Details = import("@/lib/agent/proposals").BookingDetails & import("@/lib/agent/proposals").CallbackDetails;
  const d = proposal.details as Details;
  const problem =
    proposal.kind === "booking"
      ? booking
        ? checkBooking(d, booking)
        : "This business no longer takes bookings in chat."
      : checkCallback(d);
  if (problem) throw new ApiError(422, problem);

  // Claimed before the work, so two taps cannot book twice.
  const [claimed] = await db
    .update(s.chatProposals)
    .set({ status: "confirmed", decidedAt: new Date() })
    .where(and(eq(s.chatProposals.id, proposal.id), eq(s.chatProposals.status, "pending")))
    .returning({ id: s.chatProposals.id });
  if (!claimed) throw new ApiError(409, "That card was just answered.");

  let lead: Awaited<ReturnType<typeof intakeLead>>;
  try {
    lead = await intakeLead(
      brand,
      {
        // The laundry pickup is the booking the emails are written for; any
        // other kind of booking goes out as a plain enquiry until it has its own.
        kind: proposal.kind === "callback" ? "callback" : noun === "pickup" ? "pickup" : "enquiry",
        name: d.name,
        phone: d.phone,
        email: d.email,
        services: d.services,
        address: d.address,
        pickupDate: d.date,
        timeSlot: d.timeSlot,
        notes: d.notes,
        promoCode: d.promoCode,
        preferredTime: d.preferredTime,
        topic: d.topic ?? (proposal.kind === "booking" ? undefined : "Asked in chat"),
        visitorId: clip(input.visitorId, 80),
      },
      { conversationId: conversation.id },
    );
  } catch (e) {
    await db.update(s.chatProposals).set({ status: "pending", decidedAt: null }).where(eq(s.chatProposals.id, proposal.id));
    throw e;
  }

  // Everything the chat found out goes onto the lead the team will work.
  if (lead.leadId) {
    await db.execute(sql`
      UPDATE ${s.leads} SET details = details || (SELECT captured FROM ${s.conversations} WHERE id = ${conversation.id})
      WHERE id = ${lead.leadId}
    `);
  }
  const receipt: Receipt = { reference: lead.reference, owner: lead.followUp.assignee, emailed: lead.emailed.customer };
  await db.update(s.chatProposals).set({ result: receipt }).where(eq(s.chatProposals.id, proposal.id));

  const who = receipt.owner ? `${receipt.owner.split(" ")[0]} from our team` : "Our team";
  const inbox = receipt.emailed ? " A confirmation is on its way to your inbox." : "";
  const reply =
    proposal.kind === "booking"
      ? `Done — your ${noun} is booked. Your reference is **${receipt.reference}**. ${who} will call you shortly to confirm.${inbox}`
      : `Done — ${receipt.owner ? who : "our team"} will call you back${d.preferredTime ? ` (${d.preferredTime})` : " shortly"}. Your reference is **${receipt.reference}**.${inbox}`;
  await addTurns(conversation.id, [
    { speaker: "customer", body: `(Confirmed the ${noun} details.)` },
    { speaker: "ai", body: reply },
  ]);
  return { conversationId: conversation.id, reply, proposal: { id: proposal.id, status: "confirmed" }, receipt, duplicate: false };
}

/** Any new replies from a person on the console, for a site polling a held chat. */
export async function agentChatUpdates(brand: Brand, sessionId: string, afterOrdinal: number) {
  const [conversation] = await db
    .select()
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brand.id), eq(s.conversations.externalRef, `agent:${clip(sessionId, 80)}`)))
    .limit(1);
  if (!conversation) throw new ApiError(404, "No conversation with that sessionId.");
  const turns = await db
    .select({ ordinal: s.turns.ordinal, speaker: s.turns.speaker, author: s.turns.authorName, body: s.turns.body })
    .from(s.turns)
    .where(and(eq(s.turns.conversationId, conversation.id), sql`${s.turns.ordinal} > ${afterOrdinal}`))
    .orderBy(s.turns.ordinal);
  return {
    heldBy: conversation.handledBy,
    ended: conversation.status === "resolved" || conversation.status === "abandoned",
    messages: turns
      .filter((t) => t.speaker === "human" || t.speaker === "ai")
      .map((t) => ({ ordinal: t.ordinal, from: t.speaker === "human" ? (t.author ?? "Team") : "assistant", text: t.body })),
  };
}
