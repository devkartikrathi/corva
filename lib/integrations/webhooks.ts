import { createHmac, randomBytes } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "@/lib/business/industries";
import { normaliseUrl } from "@/lib/business/website";

/**
 * Webhooks: Corva telling a business's own systems what just happened.
 *
 * One POST per event, JSON, to each URL the business registered for it:
 *
 *   { "id": "evt_…", "type": "lead.created", "createdAt": "…", "data": { … } }
 *
 * signed so the receiver can check it came from here and was not altered:
 *
 *   Corva-Signature: t=1759388400,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook's secret>
 *
 * Delivery is best-effort with one retry — an event is a notification, not
 * the record. The record is always in Corva, and a receiver that missed
 * something can read it back. Events never block the conversation that
 * caused them: they are sent after the reply.
 */

export const WEBHOOK_EVENTS = [
  { type: "lead.created", description: "A new lead — from a call, a chat, your website's form, or added by hand." },
  { type: "lead.updated", description: "A lead changed: new details, a new stage, a new owner." },
  { type: "follow_up.created", description: "Someone on the team now owes the customer something, by a time." },
  { type: "handoff.requested", description: "The AI needs a person: it reached a limit, or the customer asked for one." },
  { type: "conversation.ended", description: "A call or chat finished, with its outcome and the details collected." },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["type"] | "ping";

const TIMEOUT_MS = 6000;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

/** A URL a server may safely call: public, and https outside development. */
export function webhookUrl(input: string): string {
  // Developing against a receiver on this machine is the one private address allowed.
  if (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(input.trim())) {
    return new URL(input.trim()).toString();
  }
  const url = normaliseUrl(input);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("Webhook URLs must be https.");
  return url.toString();
}

export function sign(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function post(hook: typeof s.webhooks.$inferSelect, type: WebhookEvent, data: unknown) {
  const body = JSON.stringify({ id: `evt_${randomBytes(12).toString("hex")}`, type, createdAt: new Date().toISOString(), data });
  let status = 0;
  let error: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500));
    const t = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Corva-Webhooks/1",
          "corva-event": type,
          "corva-signature": `t=${t},v1=${sign(hook.secret, t, body)}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
      status = res.status;
      error = res.ok ? null : `HTTP ${res.status}`;
      // A 4xx is the receiver saying no; asking again will not change that.
      if (res.ok || res.status < 500) break;
    } catch (e) {
      status = 0;
      error = (e as Error).name === "TimeoutError" ? `No answer within ${TIMEOUT_MS / 1000}s` : ((e as Error).message ?? "Could not connect").slice(0, 200);
    }
  }
  await db
    .update(s.webhooks)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: status,
      lastError: error,
      failures: error ? sql`${s.webhooks.failures} + 1` : 0,
    })
    .where(eq(s.webhooks.id, hook.id));
  return { status, error };
}

/**
 * Send an event to everyone listening for it.
 *
 * Never awaited by the thing that caused it and never throws into it: the
 * work is handed to the platform to finish after the response (and simply
 * runs to completion in a long-lived process).
 */
export function emit(brandId: string, type: Exclude<WebhookEvent, "ping">, data: () => Promise<unknown> | unknown) {
  const work = (async () => {
    const hooks = await db.select().from(s.webhooks).where(eq(s.webhooks.brandId, brandId));
    const listening = hooks.filter((h) => h.events.length === 0 || h.events.includes(type));
    if (listening.length === 0) return;
    // The trigger is usually one write in a short run of them (a lead, then
    // its details, then its follow-up); let the rest land so the event shows
    // the lead as the team will see it.
    await new Promise((r) => setTimeout(r, 600));
    const payload = await data();
    if (payload == null) return;
    await Promise.all(listening.map((h) => post(h, type, payload)));
  })().catch((e) => console.error(`[webhooks] ${type} failed:`, (e as Error).message));
  try {
    waitUntil(work);
  } catch {
    // Not inside a request (a script, the local voice bridge): it just runs.
  }
}

/** A test delivery to one webhook, awaited, for the Send test button. */
export async function ping(hookId: string, brandId: string) {
  const [hook] = await db.select().from(s.webhooks).where(eq(s.webhooks.id, hookId)).limit(1);
  if (!hook || hook.brandId !== brandId) throw new Error("No such webhook for this business.");
  return post(hook, "ping", { message: "Corva can reach this URL." });
}

/** The same, for code that knows the conversation but not the business. */
export function emitForConversation(conversationId: string, type: Exclude<WebhookEvent, "ping">, data: () => Promise<unknown> | unknown) {
  void db
    .select({ brandId: s.conversations.brandId })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1)
    .then(([row]) => row && emit(row.brandId, type, data))
    .catch(() => undefined);
}

/* ─── Payloads ─────────────────────────────────────────────────────────── */

export async function followUpPayload(followUpId: string) {
  const [row] = await db
    .select({ f: s.followUps, assignee: s.memberships.name, customer: s.customers })
    .from(s.followUps)
    .leftJoin(s.memberships, eq(s.memberships.id, s.followUps.assigneeMembershipId))
    .leftJoin(s.customers, eq(s.customers.id, s.followUps.customerId))
    .where(eq(s.followUps.id, followUpId))
    .limit(1);
  if (!row) return null;
  const { f, customer } = row;
  return {
    followUp: {
      id: f.id,
      title: f.title,
      detail: f.detail,
      dueAt: f.dueAt.toISOString(),
      assignee: row.assignee,
      createdByAi: f.createdByAi,
      leadId: f.leadId,
      conversationId: f.conversationId,
    },
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email } : null,
  };
}

/** A lead as a webhook reports it: the request, the person, who owns it. */
export async function leadPayload(leadId: string) {
  const [row] = await db
    .select({ lead: s.leads, customer: s.customers, owner: s.memberships.name, industry: s.brands.industry })
    .from(s.leads)
    .innerJoin(s.brands, eq(s.brands.id, s.leads.brandId))
    .leftJoin(s.customers, eq(s.customers.id, s.leads.customerId))
    .leftJoin(s.memberships, eq(s.memberships.id, s.leads.ownerMembershipId))
    .where(eq(s.leads.id, leadId))
    .limit(1);
  if (!row) return null;
  const { lead, customer } = row;
  return {
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      interest: lead.interest,
      notes: lead.notes,
      stage: lead.stage,
      stageLabel: industryFor(row.industry).stages[lead.stage],
      valueRupees: lead.valuePaise ? lead.valuePaise / 100 : null,
      source: lead.source,
      createdByAi: lead.createdByAi,
      owner: row.owner,
      details: lead.details ?? {},
      conversationId: lead.conversationId,
      createdAt: lead.createdAt.toISOString(),
    },
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email } : null,
  };
}

export async function conversationPayload(conversationId: string) {
  const [row] = await db
    .select({ c: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return null;
  const { c, customer } = row;
  return {
    conversation: {
      id: c.id,
      channel: c.channel,
      status: c.status,
      outcome: c.outcome,
      intent: c.intent,
      handledBy: c.handledBy,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.endedAt?.toISOString() ?? null,
      durationSeconds: c.durationSeconds,
      details: c.captured ?? {},
      // The site's own session id for a chat it started, so it can join the two.
      sessionId: c.externalRef?.startsWith("agent:") ? c.externalRef.slice(6) : c.externalRef?.startsWith("chat:") ? c.externalRef.slice(5) : null,
    },
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email } : null,
  };
}
