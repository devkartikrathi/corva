import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { generateObject } from "ai";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { languageModel, thinkingOptions } from "@/lib/agent/model";
import { CHAT_MODEL_ID } from "@/lib/agent/models";
import { layout, sendEmail } from "@/lib/email";
import { accountState, blocked } from "@/lib/billing/usage";

/**
 * Customer email, by forwarding.
 *
 * Each business has a Corva address (`<localPart>@RESEND_INBOUND_DOMAIN`). It
 * forwards customer mail there from Gmail, Outlook or anywhere — ideally with a
 * filter, so only customers' mail is sent — and Resend's inbound webhook hands
 * each message to Corva the moment it arrives. No inbox password, no Google
 * approval, no polling.
 *
 * What arrives is sorted as it was when Corva read inboxes: a customer's email
 * becomes a thread on their record; newsletters, receipts and colleagues are
 * dropped unread by anyone. Replies go out from Corva, in the business's name,
 * with Reply-To set to the same Corva address — so the customer's answer comes
 * straight back onto the thread.
 *
 *   RESEND_API_KEY            sending, and fetching a received email in full
 *   RESEND_INBOUND_DOMAIN     the receiving domain: Resend's <id>.resend.app, or a
 *                             custom one with its MX record pointed at Resend
 *   RESEND_INBOUND_SECRET     the webhook's signing secret (whsec_…), for
 *                             POST /api/email/inbound, event email.received
 */

export const inboundDomain = () => process.env.RESEND_INBOUND_DOMAIN?.trim().toLowerCase().replace(/^@/, "") || null;

type Inbox = typeof s.emailInboxes.$inferSelect;

/** Addresses people share a domain with strangers on: a sender here is not a colleague. */
const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "zoho.com", "zohomail.in", "proton.me", "protonmail.com"]);
const BODY_CHARS = 4000;
const lower = (v: string | undefined | null) => (v ?? "").trim().toLowerCase();
const domainOf = (address: string) => address.split("@")[1] ?? "";
const bare = (id: string | undefined | null) => lower(id).replace(/^<|>$/g, "");

/** This business's Corva address, made the first time it is asked for. */
export async function inboxFor(brandId: string, brandSlug: string) {
  const [existing] = await db.select().from(s.emailInboxes).where(eq(s.emailInboxes.brandId, brandId)).limit(1);
  if (existing) return existing;
  const base = brandSlug.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "inbox";
  const localPart = `${base}-${randomBytes(3).toString("hex")}`;
  const [made] = await db.insert(s.emailInboxes).values({ brandId, localPart }).onConflictDoNothing().returning();
  return made ?? (await db.select().from(s.emailInboxes).where(eq(s.emailInboxes.brandId, brandId)).limit(1))[0];
}

/** The business's Corva address if it has been made (screens that only show it). */
export async function emailInboxFor(brandId: string) {
  const [row] = await db.select().from(s.emailInboxes).where(eq(s.emailInboxes.brandId, brandId)).limit(1);
  return row ?? null;
}

export const inboxAddress = (inbox: Pick<Inbox, "localPart">) => {
  const domain = inboundDomain();
  return domain ? `${inbox.localPart}@${domain}` : null;
};

/* ─── The webhook ──────────────────────────────────────────────────────── */

/**
 * Whether a webhook delivery came from Resend. Resend signs with Svix:
 * HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>", keyed on the
 * base64 secret after "whsec_", sent as one or more "v1,<base64>" entries.
 */
export function verifyInbound(raw: string, headers: Headers) {
  const secret = process.env.RESEND_INBOUND_SECRET?.trim();
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signatures.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

type Received = {
  id: string;
  to: string[];
  cc: string[];
  received_for?: string[];
  from: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  message_id: string | null;
  created_at: string;
};

/** The email in full (the webhook carries only its envelope). */
async function fetchReceived(emailId: string): Promise<Received> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status} for received email ${emailId}.`);
  return (await res.json()) as Received;
}

/** "Riya Sharma <riya@x.com>" → parts. */
function parseAddress(v: string | null | undefined) {
  const m = (v ?? "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), address: lower(m[2]) } : { name: "", address: lower(v) };
}

/** A body as plain text: Resend's text part, or the HTML (sometimes a data: URI) with its tags taken out. */
function plainText(email: Received) {
  if (email.text?.trim()) return email.text;
  let html = email.html ?? "";
  const data = html.match(/^data:[^;,]+(;base64)?,([\s\S]*)$/);
  if (data) html = data[1] ? Buffer.from(data[2], "base64").toString("utf8") : decodeURIComponent(data[2]);
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** What the person wrote, without the thread quoted underneath it. */
function tidy(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^On .{6,120} wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()));
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.trim().startsWith(">"));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, BODY_CHARS);
}

/**
 * An email someone forwarded by hand ("Forward" in their mail app) wraps the
 * customer's message under a header block. The customer is in that block, not
 * in the outer From — which is the business.
 */
function unwrapForwarded(text: string) {
  const marker = text.search(/(-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,})/i);
  if (marker < 0) return null;
  const rest = text.slice(marker).split("\n").slice(1);
  const header: Record<string, string> = {};
  let i = 0;
  for (; i < rest.length && i < 12; i++) {
    const m = rest[i].match(/^\s*(From|Date|Sent|Subject|To|Cc):\s*(.*)$/i);
    if (m) header[m[1].toLowerCase()] = m[2].trim();
    else if (rest[i].trim() === "" && Object.keys(header).length) break;
  }
  if (!header.from) return null;
  const from = parseAddress(header.from.replace(/\s*\[mailto:[^\]]+\]/i, ""));
  if (!from.address.includes("@")) return null;
  return { from, subject: header.subject ?? "", body: rest.slice(i + 1).join("\n") };
}

/** Mail no person wrote to the business: lists, notifications, receipts. */
function automated(sender: string, headers: Record<string, string>) {
  const h = (k: string) => lower(headers[k]);
  return (
    Boolean(headers["list-unsubscribe"] || headers["list-id"]) ||
    ["bulk", "list", "junk"].includes(h("precedence")) ||
    (Boolean(headers["auto-submitted"]) && h("auto-submitted") !== "no") ||
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|newsletter|news|alerts?|billing|invoices?|receipts?|updates?)@/.test(sender) ||
    /(^|[.@])(bounce|bounces|mailer|email\.|e\.|mg\.|sendgrid|amazonses|mailchimp)/.test(sender)
  );
}

const Verdict = z.object({
  customer: z.boolean().describe("True only if a person is writing to the business as a customer or prospective customer"),
  name: z.string().describe("The sender's name if they give it, else an empty string"),
  topic: z.string().describe("What they want, in three to six words"),
  summary: z.string().describe("One sentence: what they asked for or said"),
});

/** Is this someone writing in as a customer? Asked once, of the first message of a thread. */
async function judge(brandName: string, from: { name: string; address: string }, subject: string, text: string) {
  const { object } = await generateObject({
    model: languageModel(CHAT_MODEL_ID),
    providerOptions: thinkingOptions("minimal"),
    schema: Verdict,
    system: `You sort the inbox of ${brandName}. Decide whether an email is from a customer or a prospective
customer of the business: an enquiry, a booking or order request, a question, a complaint, feedback, a
request about their account. It is NOT from a customer if it is a newsletter, a receipt or invoice from a
supplier, a notification from a service, a job application, a sales pitch to the business, spam, or
personal mail. When unsure, say it is not.`,
    prompt: `From: ${from.name} <${from.address}>\nSubject: ${subject}\n\n${text.slice(0, 1500)}`,
  });
  return object;
}

async function addTurn(conversationId: string, speaker: "customer" | "human", author: string, body: string, at: Date) {
  const [last] = await db.select({ ordinal: s.turns.ordinal }).from(s.turns).where(eq(s.turns.conversationId, conversationId)).orderBy(desc(s.turns.ordinal)).limit(1);
  await db.insert(s.turns).values({ conversationId, ordinal: (last?.ordinal ?? -1) + 1, speaker, authorName: author, body, createdAt: at });
}

async function customerByEmail(brandId: string, address: string, name: string) {
  const [known] = await db.select().from(s.customers).where(and(eq(s.customers.brandId, brandId), sql`lower(${s.customers.email}) = ${address}`)).limit(1);
  if (known) return known;
  const [made] = await db.insert(s.customers).values({ brandId, name: name || address.split("@")[0], email: address, segment: "Email" }).returning();
  return made;
}

const baseSubject = (subject: string) => subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, "").trim().toLowerCase();

/** The thread a message belongs to: by its reply headers, else the same customer and subject lately. */
async function threadFor(brandId: string, headers: Record<string, string>, address: string, subject: string) {
  const refs = [headers["in-reply-to"], ...(headers["references"] ?? "").split(/\s+/)].map(bare).filter(Boolean);
  if (refs.length) {
    const [hit] = await db
      .select({ conversationId: s.emailMessages.conversationId })
      .from(s.emailMessages)
      .where(and(eq(s.emailMessages.brandId, brandId), inArray(s.emailMessages.messageId, refs)))
      .orderBy(desc(s.emailMessages.createdAt))
      .limit(1);
    if (hit?.conversationId) return hit.conversationId;
  }
  const key = baseSubject(subject);
  if (!key) return null;
  const recent = await db
    .select({ conversationId: s.emailMessages.conversationId, subject: s.emailMessages.subject })
    .from(s.emailMessages)
    .where(and(eq(s.emailMessages.brandId, brandId), eq(s.emailMessages.address, address), gte(s.emailMessages.createdAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(s.emailMessages.createdAt))
    .limit(20);
  return recent.find((r) => r.conversationId && baseSubject(r.subject ?? "") === key)?.conversationId ?? null;
}

export type Taken = "duplicate" | "no-business" | "confirmation" | "not-a-customer" | "kept";

/**
 * One received email, start to finish. Safe to call twice for the same email
 * (a webhook retried): the second call changes nothing.
 */
export async function takeReceived(emailId: string): Promise<TakenResult> {
  const [seen] = await db.select({ id: s.emailMessages.id }).from(s.emailMessages).where(eq(s.emailMessages.providerId, emailId)).limit(1);
  if (seen) return { outcome: "duplicate" };

  const email = await fetchReceived(emailId);
  const domain = inboundDomain();
  const ours = [...(email.received_for ?? []), ...email.to, ...email.cc].map((a) => parseAddress(a).address).find((a) => domain && a.endsWith(`@${domain}`));
  const [inbox] = ours ? await db.select().from(s.emailInboxes).where(eq(s.emailInboxes.localPart, ours.split("@")[0])).limit(1) : [];
  if (!inbox) return { outcome: "no-business" };
  const [brand] = await db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).where(eq(s.brands.id, inbox.brandId)).limit(1);

  // Claimed before anything else is done with it: a delivery Resend makes twice
  // (it retries a slow answer) must not become two threads or two replies.
  const [claimed] = await db
    .insert(s.emailMessages)
    .values({ brandId: inbox.brandId, direction: "in", providerId: emailId })
    .onConflictDoNothing()
    .returning({ id: s.emailMessages.id });
  if (!claimed) return { outcome: "duplicate" };
  try {
    return await sortReceived(emailId, email, inbox, brand, claimed.id);
  } catch (e) {
    // Let go of it, so Resend's retry is taken rather than dropped as a duplicate.
    await db.delete(s.emailMessages).where(eq(s.emailMessages.id, claimed.id));
    throw e;
  }
}

type TakenResult = { outcome: Taken; brandId?: string; conversationId?: string; answer?: { body: string } };

/** A claimed email, sorted: a forwarding confirmation, a customer's thread, or nothing to keep. */
async function sortReceived(emailId: string, email: Received, inbox: Inbox, brand: { id: string; name: string }, claimedId: string): Promise<TakenResult> {
  const domain = inboundDomain();
  await db.update(s.emailInboxes).set({ received: sql`${s.emailInboxes.received} + 1`, lastReceivedAt: new Date() }).where(eq(s.emailInboxes.brandId, inbox.brandId));

  const headers = Object.fromEntries(Object.entries(email.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const outer = parseAddress(email.from);
  const text = plainText(email);
  const subject = (email.subject ?? "").trim().slice(0, 200);
  const at = new Date(email.created_at || Date.now());
  const mark = (conversationId: string | null, address: string | null) =>
    db
      .update(s.emailMessages)
      .set({ conversationId, messageId: bare(email.message_id ?? headers["message-id"]), address, subject })
      .where(eq(s.emailMessages.id, claimedId));

  // "Confirm you may forward to this address": shown to the business, never acted on.
  if (/forwarding-noreply@google\.com/.test(outer.address) || /forwarding confirmation/i.test(subject)) {
    const code = text.match(/confirmation code[:\s]*([0-9]{6,12})/i)?.[1] ?? subject.match(/\(#(\d{6,12})\)/)?.[1] ?? null;
    const link = text.match(/https:\/\/[^\s"<>]*google\.com\/mail[^\s"<>]*/i)?.[0] ?? null;
    await db.update(s.emailInboxes).set({ confirmation: { code, link, from: outer.address, at: at.toISOString() } }).where(eq(s.emailInboxes.brandId, inbox.brandId));
    await mark(null, null);
    return { outcome: "confirmation", brandId: inbox.brandId };
  }

  // Forwarded by hand: the customer is inside the message, not in its From.
  const wrapped = unwrapForwarded(text);
  const from = wrapped?.from ?? outer;
  const body = tidy(wrapped?.body ?? text);
  const topic = (wrapped?.subject || subject).replace(/^\s*((fw|fwd)\s*:\s*)+/i, "").trim();
  if (!body) {
    await mark(null, from.address);
    return { outcome: "not-a-customer", brandId: inbox.brandId };
  }

  const existing = await threadFor(inbox.brandId, headers, from.address, topic);
  if (existing) {
    // They wrote again on a thread we hold: it is waiting on the business once more.
    // The assistant answers unless a person has taken the thread or it is waiting for one.
    const [thread] = await db
      .select({ handledBy: s.conversations.handledBy, status: s.conversations.status, outcome: s.conversations.outcome })
      .from(s.conversations)
      .where(eq(s.conversations.id, existing))
      .limit(1);
    const withTeam = thread?.outcome === "escalated" || thread?.status === "waiting_human";
    const assistant = inbox.aiReplies && !thread?.handledBy && !withTeam;
    if (!assistant) await addTurn(existing, "customer", from.name || from.address, body, at);
    // A thread already with the team stays marked as needing them.
    if (!withTeam) await db.update(s.conversations).set({ outcome: null, endedAt: null }).where(eq(s.conversations.id, existing));
    await mark(existing, from.address);
    await db.update(s.emailInboxes).set({ kept: sql`${s.emailInboxes.kept} + 1` }).where(eq(s.emailInboxes.brandId, inbox.brandId));
    return { outcome: "kept", brandId: inbox.brandId, conversationId: existing, ...(assistant ? { answer: { body } } : {}) };
  }

  // A new thread: only a person writing in as a customer, and never a colleague.
  const businessAddresses = email.to.map((a) => parseAddress(a).address).filter((a) => !domain || !a.endsWith(`@${domain}`));
  const colleague = businessAddresses.some((a) => domainOf(a) === domainOf(from.address) && !PUBLIC_MAIL.has(domainOf(from.address)));
  if (!wrapped && (automated(from.address, headers) || colleague)) {
    await mark(null, null);
    return { outcome: "not-a-customer", brandId: inbox.brandId };
  }
  const verdict = await judge(brand.name, from, topic, body);
  if (!verdict.customer) {
    await mark(null, null);
    return { outcome: "not-a-customer", brandId: inbox.brandId };
  }

  const customer = await customerByEmail(inbox.brandId, from.address, from.name || verdict.name);
  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: inbox.brandId,
      customerId: customer.id,
      channel: "email",
      intent: (topic || verdict.topic).slice(0, 120),
      // Never "live": nobody is on the line. A thread with no outcome is one still to be answered.
      status: "resolved",
      startedAt: at,
      externalRef: `email:${emailId}`,
      summary: verdict.summary.slice(0, 400),
    })
    .returning();
  // The assistant's turn writes the customer's message itself; otherwise it is written here.
  if (!inbox.aiReplies) await addTurn(conversation.id, "customer", from.name || from.address, body, at);
  await mark(conversation.id, from.address);
  await db.update(s.emailInboxes).set({ kept: sql`${s.emailInboxes.kept} + 1` }).where(eq(s.emailInboxes.brandId, inbox.brandId));
  return { outcome: "kept", brandId: inbox.brandId, conversationId: conversation.id, ...(inbox.aiReplies ? { answer: { body } } : {}) };
}

/* ─── Replying ─────────────────────────────────────────────────────────── */

/**
 * Answer an email thread from Corva, in the business's name.
 *
 * The email says which business it is and which message it answers, because
 * it comes from Corva's sending address, not the business's own. Reply-To is
 * the business's Corva address, so the customer's answer returns to this
 * thread without anyone forwarding it.
 */
/**
 * Send a reply on an email thread, threaded to the customer's last message.
 *
 * It comes from Corva's sending address, so it says whose reply it is and to
 * which message; Reply-To is the business's Corva address, so the customer's
 * answer returns to this thread without anyone forwarding it.
 */
async function sendThreadEmail(conversationId: string, brand: { id: string; name: string; slug: string }, body: string, opts: { greet: boolean }) {
  const [thread] = await db
    .select({ c: s.conversations, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.brandId, brand.id), eq(s.conversations.channel, "email")))
    .limit(1);
  if (!thread) throw new Error("No such email thread.");
  const to = thread.customer?.email;
  if (!to) throw new Error("This customer has no email address on record.");

  const inbox = await inboxFor(brand.id, brand.slug);
  const replyTo = inboxAddress(inbox) ?? undefined;
  const [last] = await db
    .select({ messageId: s.emailMessages.messageId })
    .from(s.emailMessages)
    .where(and(eq(s.emailMessages.conversationId, conversationId), eq(s.emailMessages.direction, "in")))
    .orderBy(desc(s.emailMessages.createdAt))
    .limit(1);
  const topic = thread.c.intent ?? "your message";
  const messageId = `corva-${randomBytes(12).toString("hex")}@${inboundDomain() ?? "corva"}`;
  const first = thread.customer?.name && !/@/.test(thread.customer.name) ? thread.customer.name.split(" ")[0] : null;
  const mail = layout({
    heading: `${brand.name} has replied`,
    lines: [
      opts.greet ? `${first ? `Hi ${first}, this` : "This"} is ${brand.name}'s reply to your message “${topic}”.` : `In reply to your message “${topic}”:`,
      // What the assistant writes is plain text; any markdown it slips in is taken out.
      ...body
        .replace(/\*\*|__|^#+\s*/gm, "")
        .replace(/[ \t]+$/gm, "")
        .split(/\n{2,}/),
    ],
    footer: `Reply to this email and it reaches ${brand.name} directly. Sent for ${brand.name} by Corva.`,
  });
  const sent = await sendEmail({
    to,
    subject: `Re: ${topic}`,
    html: mail.html,
    text: mail.text,
    fromName: brand.name,
    replyTo,
    headers: {
      "Message-ID": `<${messageId}>`,
      ...(last?.messageId ? { "In-Reply-To": `<${last.messageId}>`, References: `<${last.messageId}>` } : {}),
    },
  });
  if (!sent.sent) throw new Error(sent.reason ?? "The email could not be sent.");
  await db.insert(s.emailMessages).values({ brandId: brand.id, conversationId, direction: "out", providerId: sent.id ?? null, messageId, address: to, subject: `Re: ${topic}` });
  return { to, handledBy: thread.c.handledBy };
}

/** A person on the team answers a thread from Corva. From then on the thread is theirs. */
export async function replyOnThread(conversationId: string, brand: { id: string; name: string; slug: string }, text: string, by: string) {
  const body = text.trim();
  if (!body) throw new Error("Nothing to send.");
  if (body.length > 8000) throw new Error("That reply is too long.");
  const { handledBy } = await sendThreadEmail(conversationId, brand, body, { greet: true });
  await addTurn(conversationId, "human", by, body, new Date());
  await db.update(s.conversations).set({ outcome: "human_resolved", handledBy: handledBy ?? by, endedAt: new Date() }).where(eq(s.conversations.id, conversationId));
  // Answered: a handoff the assistant raised on this thread is done with.
  await db
    .update(s.handoffs)
    .set({ status: "resolved" })
    .where(and(eq(s.handoffs.conversationId, conversationId), inArray(s.handoffs.status, ["waiting", "accepted"])));
}

/**
 * The assistant answers a customer's email, as it would a chat message.
 *
 * Runs the same turn as every channel (knowledge, catalog, the business's
 * records, payment links, handoffs), written as an email, and sends it. A turn
 * that brings in a person sends the holding reply and leaves the thread
 * waiting for them. Nothing is lost if it fails: the customer's message is
 * then on the thread for the team to answer.
 */
export async function answerEmail(conversationId: string, body: string) {
  const [row] = await db
    .select({ c: s.conversations, brand: s.brands })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return { answered: false, reason: "no such thread" };
  const { brand } = row;
  const leaveForTeam = async (reason: string) => {
    const [mine] = await db
      .select({ id: s.turns.id })
      .from(s.turns)
      .where(and(eq(s.turns.conversationId, conversationId), eq(s.turns.speaker, "customer"), eq(s.turns.body, body)))
      .limit(1);
    if (!mine) await addTurn(conversationId, "customer", "Customer", body, new Date());
    await db.update(s.conversations).set({ outcome: null, endedAt: null }).where(eq(s.conversations.id, conversationId));
    return { answered: false, reason };
  };

  // The plan's allowance is the business's: past it, the team answers.
  const reason = blocked(await accountState(brand.orgId), "chat");
  if (reason) return leaveForTeam(reason);

  let reply;
  try {
    // Loaded here: the agent reaches modules that reach this one.
    const { respond } = await import("@/lib/agent/respond");
    reply = await respond({ conversationId, message: body });
  } catch (e) {
    console.error("[email] the assistant could not answer", (e as Error).message);
    return leaveForTeam("the assistant could not answer");
  }
  if (!reply.text.trim()) return leaveForTeam("the assistant had nothing to say");

  try {
    await sendThreadEmail(conversationId, { id: brand.id, name: brand.name, slug: brand.slug }, reply.text, { greet: false });
  } catch (e) {
    console.error("[email] the assistant's reply could not be sent", (e as Error).message);
    await db.update(s.conversations).set({ outcome: null, endedAt: null }).where(eq(s.conversations.id, conversationId));
    return { answered: false, reason: (e as Error).message };
  }
  // Answered by the assistant, unless it brought in a person — then the team owes the next reply.
  // An email thread is never "live": the handoff waits in the team's queue, not on a line.
  await db
    .update(s.conversations)
    .set(reply.escalation ? { status: "resolved", endedAt: new Date() } : { status: "resolved", outcome: "ai_resolved", endedAt: new Date() })
    .where(eq(s.conversations.id, conversationId));
  return { answered: true, escalated: Boolean(reply.escalation) };
}

/** The email conversations on record, newest first, for the Email screen. */
export async function emailThreads(brandId: string, limit = 40) {
  return db
    .select({
      id: s.conversations.id,
      subject: s.conversations.intent,
      summary: s.conversations.summary,
      outcome: s.conversations.outcome,
      handledBy: s.conversations.handledBy,
      startedAt: s.conversations.startedAt,
      customerId: s.customers.id,
      customerName: s.customers.name,
      customerEmail: s.customers.email,
    })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.channel, "email")))
    .orderBy(desc(s.conversations.startedAt))
    .limit(limit);
}
