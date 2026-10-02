import { and, asc, desc, eq, gte, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { LEAD_STAGES, industryFor, type LeadStage } from "@/lib/business/industries";
import { cleanDetails, intakeFieldsFor } from "@/lib/business/intake";
import { phoneDigits } from "@/lib/business/phone";
import { ApiError } from "./api";
import { emit, leadPayload } from "./webhooks";

/**
 * Reading a business's records back out, over the API.
 *
 * Webhooks tell a business's systems the moment something happens; these are
 * for everything else — a nightly sync, a dashboard, "which leads asked for
 * curtains this week". The business's own Details to collect are stored as
 * `{ key: value }` on each lead and conversation, so any of them can be
 * filtered on by key without Corva knowing in advance what a business
 * collects: `?details.request_type=Curtains`.
 *
 * Lists are newest-changed first and paged with an opaque `cursor`.
 */

type Brand = typeof s.brands.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limitOf = (params: URLSearchParams) => Math.min(100, Math.max(1, Number(params.get("limit")) || 25));

function dateOf(value: string | null, name: string) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new ApiError(400, `${name} is not a valid date — use ISO 8601, e.g. 2026-10-01 or 2026-10-01T09:00:00Z.`);
  return d;
}

/** `updatedAt|id`, opaque to the caller. */
const cursorFor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function afterCursor(cursor: string | null, at: SQL | AnyColumn, id: AnyColumn) {
  if (!cursor) return undefined;
  const [iso, rowId] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!iso || isNaN(new Date(iso).getTime()) || !UUID.test(rowId ?? "")) throw new ApiError(400, "That cursor is not valid.");
  return sql`(${at}, ${id}) < (${iso}::timestamptz, ${rowId}::uuid)`;
}

/** `details.<key>=<value>` filters, matched case-insensitively against the stored value. */
function detailFilters(params: URLSearchParams, column: AnyColumn) {
  const filters: SQL[] = [];
  for (const [name, value] of params) {
    if (!name.startsWith("details.")) continue;
    const key = name.slice(8);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw new ApiError(400, `"${name}" is not a field key. Keys come from GET /api/v1/config.`);
    filters.push(value === "" ? sql`${column} ? ${key}` : sql`lower(${column} ->> ${key}) = ${value.toLowerCase()}`);
  }
  return filters;
}

const customerJson = (c: typeof s.customers.$inferSelect | null) =>
  c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.location } : null;

/* ─── Leads ────────────────────────────────────────────────────────────── */

function leadJson(lead: typeof s.leads.$inferSelect, owner: string | null, industry: string) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    interest: lead.interest,
    notes: lead.notes,
    stage: lead.stage,
    stageLabel: industryFor(industry).stages[lead.stage],
    valueRupees: lead.valuePaise ? lead.valuePaise / 100 : null,
    source: lead.source,
    createdByAi: lead.createdByAi,
    owner,
    details: lead.details ?? {},
    request: lead.request ?? null,
    customerId: lead.customerId,
    conversationId: lead.conversationId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export async function listLeads(brand: Brand, params: URLSearchParams) {
  const limit = limitOf(params);
  const where: (SQL | undefined)[] = [eq(s.leads.brandId, brand.id)];

  const stages = (params.get("stage") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (stages.length) {
    const bad = stages.find((x) => !LEAD_STAGES.includes(x as LeadStage));
    if (bad) throw new ApiError(400, `"${bad}" is not a stage. Stages: ${LEAD_STAGES.join(", ")}.`);
    where.push(inArray(s.leads.stage, stages as LeadStage[]));
  }
  const since = dateOf(params.get("since"), "since");
  if (since) where.push(gte(s.leads.createdAt, since));
  const updatedSince = dateOf(params.get("updatedSince"), "updatedSince");
  if (updatedSince) where.push(gte(s.leads.updatedAt, updatedSince));
  const phone = params.get("phone");
  if (phone) {
    const digits = phoneDigits(phone);
    where.push(sql`regexp_replace(coalesce(${s.leads.phone}, ''), '\\D', '', 'g') in (${digits}, ${digits.slice(2)})`);
  }
  const reference = params.get("reference");
  if (reference) where.push(sql`${s.leads.request} ->> 'reference' = ${reference}`);
  const q = params.get("q")?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(s.leads.name, pattern), ilike(s.leads.interest, pattern), ilike(s.leads.notes, pattern)));
  }
  where.push(...detailFilters(params, s.leads.details));
  where.push(afterCursor(params.get("cursor"), s.leads.updatedAt, s.leads.id));

  const rows = await db
    .select({ lead: s.leads, owner: s.memberships.name })
    .from(s.leads)
    .leftJoin(s.memberships, eq(s.memberships.id, s.leads.ownerMembershipId))
    .where(and(...where))
    .orderBy(desc(s.leads.updatedAt), desc(s.leads.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    leads: page.map((r) => leadJson(r.lead, r.owner, brand.industry)),
    nextCursor: rows.length > limit && last ? cursorFor(last.lead.updatedAt, last.lead.id) : null,
  };
}

async function ownLead(brand: Brand, id: string) {
  if (!UUID.test(id)) throw new ApiError(404, "No lead with that id.");
  const [row] = await db
    .select({ lead: s.leads, owner: s.memberships.name, customer: s.customers })
    .from(s.leads)
    .leftJoin(s.memberships, eq(s.memberships.id, s.leads.ownerMembershipId))
    .leftJoin(s.customers, eq(s.customers.id, s.leads.customerId))
    .where(and(eq(s.leads.id, id), eq(s.leads.brandId, brand.id)))
    .limit(1);
  if (!row) throw new ApiError(404, "No lead with that id.");
  return row;
}

export async function getLead(brand: Brand, id: string) {
  const row = await ownLead(brand, id);
  const followUps = await db
    .select({ f: s.followUps, assignee: s.memberships.name })
    .from(s.followUps)
    .leftJoin(s.memberships, eq(s.memberships.id, s.followUps.assigneeMembershipId))
    .where(eq(s.followUps.leadId, id))
    .orderBy(asc(s.followUps.dueAt));
  return {
    lead: leadJson(row.lead, row.owner, brand.industry),
    customer: customerJson(row.customer),
    followUps: followUps.map(({ f, assignee }) => ({
      id: f.id,
      title: f.title,
      detail: f.detail,
      dueAt: f.dueAt.toISOString(),
      status: f.status,
      assignee,
      outcome: f.outcome,
      completedAt: f.completedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Change a lead from the business's own system: its stage (an order delivered
 * there is a lead won here), its notes, its details. Anything not sent is left
 * as it is. Tells webhooks, like a change made in the console.
 */
export async function updateLead(brand: Brand, id: string, body: { stage?: unknown; lostReason?: unknown; notes?: unknown; details?: unknown; valueRupees?: unknown }) {
  const { lead } = await ownLead(brand, id);
  const set: Partial<typeof s.leads.$inferInsert> = {};

  if (body.stage !== undefined) {
    if (typeof body.stage !== "string" || !LEAD_STAGES.includes(body.stage as LeadStage)) {
      throw new ApiError(400, `stage must be one of: ${LEAD_STAGES.join(", ")}.`);
    }
    if (body.stage !== lead.stage) {
      set.stage = body.stage as LeadStage;
      set.stageChangedAt = new Date();
      set.lostReason = body.stage === "lost" && typeof body.lostReason === "string" ? body.lostReason.trim().slice(0, 300) || null : null;
    }
  }
  if (typeof body.notes === "string") set.notes = body.notes.trim().slice(0, 4000) || null;
  if (body.valueRupees !== undefined) {
    const v = Number(body.valueRupees);
    if (body.valueRupees !== null && (!Number.isFinite(v) || v < 0)) throw new ApiError(400, "valueRupees must be a number, or null.");
    set.valuePaise = body.valueRupees === null || v === 0 ? null : Math.round(v * 100);
  }
  let details: Record<string, string> | null = null;
  if (body.details !== undefined) {
    if (!body.details || typeof body.details !== "object") throw new ApiError(400, "details must be an object of { key: value }.");
    details = cleanDetails(await intakeFieldsFor(brand.id, brand.industry), body.details as Record<string, unknown>).clean;
  }

  if (Object.keys(set).length || (details && Object.keys(details).length)) {
    await db
      .update(s.leads)
      .set({ ...set, ...(details && Object.keys(details).length ? { details: sql`${s.leads.details} || ${JSON.stringify(details)}::jsonb` } : {}), updatedAt: new Date() })
      .where(eq(s.leads.id, id));
    emit(brand.id, "lead.updated", () => leadPayload(id));
  }
  return getLead(brand, id);
}

/* ─── Customers ────────────────────────────────────────────────────────── */

export async function listCustomers(brand: Brand, params: URLSearchParams) {
  const limit = limitOf(params);
  const where: (SQL | undefined)[] = [eq(s.customers.brandId, brand.id)];
  const since = dateOf(params.get("since"), "since");
  if (since) where.push(gte(s.customers.createdAt, since));
  const phone = params.get("phone");
  if (phone) {
    const digits = phoneDigits(phone);
    where.push(sql`regexp_replace(coalesce(${s.customers.phone}, ''), '\\D', '', 'g') in (${digits}, ${digits.slice(2)})`);
  }
  const email = params.get("email");
  if (email) where.push(sql`lower(${s.customers.email}) = ${email.trim().toLowerCase()}`);
  const q = params.get("q")?.trim();
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(s.customers.name, pattern), ilike(s.customers.email, pattern), ilike(s.customers.phone, pattern)));
  }
  where.push(afterCursor(params.get("cursor"), s.customers.createdAt, s.customers.id));

  const rows = await db
    .select({
      c: s.customers,
      leads: sql<number>`(select count(*)::int from ${s.leads} l where l.customer_id = customers.id)`,
      openLeads: sql<number>`(select count(*)::int from ${s.leads} l where l.customer_id = customers.id and l.stage in ('new', 'contacted', 'qualified', 'proposal'))`,
      lastConversationAt: sql<Date | null>`(select max(cv.started_at) from ${s.conversations} cv where cv.customer_id = customers.id)`,
    })
    .from(s.customers)
    .where(and(...where))
    .orderBy(desc(s.customers.createdAt), desc(s.customers.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    customers: page.map((r) => ({
      ...customerJson(r.c)!,
      owner: r.c.owner,
      leads: r.leads,
      openLeads: r.openLeads,
      lastConversationAt: r.lastConversationAt ? new Date(r.lastConversationAt).toISOString() : null,
      createdAt: r.c.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? cursorFor(last.c.createdAt, last.c.id) : null,
  };
}

export async function getCustomer(brand: Brand, id: string) {
  if (!UUID.test(id)) throw new ApiError(404, "No customer with that id.");
  const [c] = await db.select().from(s.customers).where(and(eq(s.customers.id, id), eq(s.customers.brandId, brand.id))).limit(1);
  if (!c) throw new ApiError(404, "No customer with that id.");

  const [leads, conversations] = await Promise.all([
    db
      .select({ lead: s.leads, owner: s.memberships.name })
      .from(s.leads)
      .leftJoin(s.memberships, eq(s.memberships.id, s.leads.ownerMembershipId))
      .where(eq(s.leads.customerId, id))
      .orderBy(desc(s.leads.updatedAt))
      .limit(50),
    db.select().from(s.conversations).where(eq(s.conversations.customerId, id)).orderBy(desc(s.conversations.startedAt)).limit(50),
  ]);
  // Everything ever collected about them, the newest answer to each question winning.
  const details = [...leads].reverse().reduce<Record<string, string>>((all, r) => ({ ...all, ...(r.lead.details ?? {}) }), {});
  return {
    customer: { ...customerJson(c)!, owner: c.owner, createdAt: c.createdAt.toISOString() },
    details,
    leads: leads.map((r) => leadJson(r.lead, r.owner, brand.industry)),
    conversations: conversations.map((cv) => conversationJson(cv)),
  };
}

/* ─── Conversations ────────────────────────────────────────────────────── */

function conversationJson(c: typeof s.conversations.$inferSelect) {
  return {
    id: c.id,
    channel: c.channel === "phone" ? "voice" : c.channel,
    status: c.status,
    outcome: c.outcome,
    intent: c.intent,
    summary: c.liveSummary,
    handledBy: c.handledBy,
    isTest: c.isTest,
    customerId: c.customerId,
    // The site's own id for a chat it started.
    sessionId: c.externalRef?.startsWith("agent:") ? c.externalRef.slice(6) : c.externalRef?.startsWith("chat:") ? c.externalRef.slice(5) : null,
    details: c.captured ?? {},
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSeconds: c.durationSeconds,
  };
}

export async function listConversations(brand: Brand, params: URLSearchParams) {
  const limit = limitOf(params);
  const where: (SQL | undefined)[] = [eq(s.conversations.brandId, brand.id)];
  const since = dateOf(params.get("since"), "since");
  if (since) where.push(gte(s.conversations.startedAt, since));
  const channel = params.get("channel");
  if (channel) {
    if (channel !== "chat" && channel !== "voice") throw new ApiError(400, 'channel is "chat" or "voice".');
    where.push(channel === "voice" ? eq(s.conversations.channel, "phone") : sql`${s.conversations.channel} <> 'phone'`);
  }
  const sessionId = params.get("sessionId");
  if (sessionId) where.push(inArray(s.conversations.externalRef, [`agent:${sessionId}`, `chat:${sessionId}`]));
  const customerId = params.get("customerId");
  if (customerId) {
    if (!UUID.test(customerId)) throw new ApiError(400, "customerId is not valid.");
    where.push(eq(s.conversations.customerId, customerId));
  }
  if (params.get("includeTests") !== "true") where.push(eq(s.conversations.isTest, false));
  where.push(...detailFilters(params, s.conversations.captured));
  where.push(afterCursor(params.get("cursor"), s.conversations.startedAt, s.conversations.id));

  const rows = await db
    .select()
    .from(s.conversations)
    .where(and(...where))
    .orderBy(desc(s.conversations.startedAt), desc(s.conversations.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    conversations: page.map(conversationJson),
    nextCursor: rows.length > limit && last ? cursorFor(last.startedAt, last.id) : null,
  };
}

export async function getConversation(brand: Brand, id: string) {
  if (!UUID.test(id)) throw new ApiError(404, "No conversation with that id.");
  const [row] = await db
    .select({ c: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.id, id), eq(s.conversations.brandId, brand.id)))
    .limit(1);
  if (!row) throw new ApiError(404, "No conversation with that id.");
  const turns = await db
    .select({ ordinal: s.turns.ordinal, speaker: s.turns.speaker, author: s.turns.authorName, body: s.turns.body, at: s.turns.atSeconds })
    .from(s.turns)
    .where(eq(s.turns.conversationId, id))
    .orderBy(asc(s.turns.ordinal));
  return {
    conversation: conversationJson(row.c),
    customer: customerJson(row.customer),
    transcript: turns.map((t) => ({
      ordinal: t.ordinal,
      from: t.speaker === "customer" ? "customer" : t.speaker === "ai" ? "assistant" : t.speaker === "human" ? (t.author ?? "team") : "system",
      text: t.body,
      atSeconds: t.at,
    })),
  };
}
