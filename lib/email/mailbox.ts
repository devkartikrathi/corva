import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { languageModel, thinkingOptions } from "@/lib/agent/model";
import { CHAT_MODEL_ID } from "@/lib/agent/models";
import { seal, unseal } from "@/lib/data/crypto";
import { DataSourceError, publicAddress } from "@/lib/data/postgres";

/**
 * A business's email inbox, read for its customers.
 *
 * Customer management is every way a customer reaches the business, not only
 * the ways that run through Corva. So the business connects its inbox, and
 * Corva reads what arrives: a message from a customer becomes a conversation
 * on that customer's record (the customer is made if they are new), and the
 * business's reply, sent from its own mail client as always, is added to it.
 *
 * What is not from a customer is not kept — not the text, not the sender.
 * Corva reads only; it never sends, moves, flags or deletes mail.
 */

export class MailboxError extends DataSourceError {}

export const PROVIDERS = [
  { key: "gmail", label: "Gmail / Google Workspace", host: "imap.gmail.com", help: "Turn on 2-Step Verification, then make an app password at myaccount.google.com/apppasswords and paste it here. Your normal password will not work." },
  { key: "zoho_in", label: "Zoho Mail (India)", host: "imap.zoho.in", help: "In Zoho Mail settings turn on IMAP access, then make an app-specific password under Security." },
  { key: "zoho", label: "Zoho Mail", host: "imap.zoho.com", help: "In Zoho Mail settings turn on IMAP access, then make an app-specific password under Security." },
  { key: "titan", label: "Titan (GoDaddy, Hostinger, BigRock)", host: "imap.titan.email", help: "Use the mailbox's own password. Turn on third-party app access in Titan's settings if sign-in is refused." },
  { key: "hostinger", label: "Hostinger Email", host: "imap.hostinger.com", help: "Use the mailbox's own password." },
  { key: "yahoo", label: "Yahoo Mail", host: "imap.mail.yahoo.com", help: "Make an app password under Account security and paste it here." },
  { key: "other", label: "Another provider", host: "", help: "Enter the IMAP server your provider gives you (it usually starts with imap. or mail.) — it must accept a secure connection on port 993." },
] as const;

/** Addresses people share a domain with strangers on: a sender here is not a colleague. */
const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "zoho.com", "zohomail.in", "proton.me", "protonmail.com"]);

const FIRST_SYNC_DAYS = 14;
const PER_SYNC = 40;
const BODY_CHARS = 4000;
/** Up to here a message is fetched whole; beyond it, only its head, where the text is. */
const WHOLE_MESSAGE_BYTES = 1_500_000;
const LARGE_MESSAGE_HEAD_BYTES = 200_000;
/** A sync that started this long ago and never finished is taken to have died. */
const STALE_SYNC_MS = 3 * 60_000;
/** Reading the inbox again sooner than this is not worth a connection. */
export const FRESH_MS = 5 * 60_000;

type Mailbox = typeof s.mailboxes.$inferSelect;
type Cursor = { validity: string; uid: number };

const lower = (v: string | undefined | null) => (v ?? "").trim().toLowerCase();
const domainOf = (address: string) => address.split("@")[1] ?? "";

async function client(host: string, username: string, password: string) {
  const address = await publicAddress(host, "The mail server");
  return new ImapFlow({
    host: address,
    port: 993,
    secure: true,
    // The certificate is checked against the name the business gave, not the address.
    tls: { servername: host },
    auth: { user: username, pass: password },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

function plain(e: unknown): MailboxError {
  if (e instanceof DataSourceError) return new MailboxError(e.message);
  const err = e as { message?: string; authenticationFailed?: boolean; responseText?: string; code?: string };
  if (err.authenticationFailed) {
    return new MailboxError("The mail server refused that address or password. Most providers need an app password here, not your normal one.");
  }
  if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED" || /timeout/i.test(err.message ?? "")) {
    return new MailboxError("Could not reach the mail server. Check the server name, and that IMAP is turned on for this mailbox.");
  }
  return new MailboxError((err.responseText || err.message || "The mail server did not answer.").replace(/\s+/g, " ").slice(0, 200));
}

/* ─── Connecting ───────────────────────────────────────────────────────── */

export async function mailboxFor(brandId: string) {
  const [row] = await db.select().from(s.mailboxes).where(eq(s.mailboxes.brandId, brandId)).limit(1);
  return row ?? null;
}

/** Connect an inbox: prove the sign-in works, and keep it sealed. Nothing is read yet. */
export async function connectMailbox(brandId: string, input: { address: string; password: string; host: string }, by: string) {
  const address = lower(input.address);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new MailboxError("Enter the full email address.");
  const host = lower(input.host).replace(/^imaps?:\/\//, "").replace(/[:/].*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new MailboxError("Enter the mail server, like imap.yourprovider.com");
  // Google shows its app passwords in groups of four; the spaces are not part of it.
  const password = host === "imap.gmail.com" ? input.password.replace(/\s+/g, "") : input.password.trim();
  if (!password) throw new MailboxError("Enter the password or app password.");

  let imap: ImapFlow | null = null;
  try {
    imap = await client(host, address, password);
    await imap.connect();
    await imap.mailboxOpen("INBOX", { readOnly: true });
  } catch (e) {
    throw plain(e);
  } finally {
    await imap?.logout().catch(() => {});
  }

  const values = { address, host, username: address, secret: seal(password), cursor: {}, seen: 0, kept: 0, lastSyncedAt: null, syncingSince: null, lastError: null };
  const [row] = await db
    .insert(s.mailboxes)
    .values({ brandId, createdByName: by, ...values })
    .onConflictDoUpdate({ target: s.mailboxes.brandId, set: values })
    .returning();
  return row;
}

/** Stop reading the inbox. Conversations already recorded stay on their customers. */
export async function disconnectMailbox(brandId: string) {
  const [row] = await db.delete(s.mailboxes).where(eq(s.mailboxes.brandId, brandId)).returning();
  return row ?? null;
}

/* ─── Reading ──────────────────────────────────────────────────────────── */

type Message = {
  uid: number;
  id: string;
  /** The first message of the thread this belongs to. */
  root: string;
  from: { address: string; name: string };
  to: string[];
  subject: string;
  text: string;
  date: Date;
  automated: boolean;
};

const messageId = (v: string | undefined) => lower(v).replace(/^<|>$/g, "");

function read(uid: number, mail: ParsedMail): Message | null {
  const from = mail.from?.value[0];
  if (!from?.address) return null;
  const references = (Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : []).map(messageId).filter(Boolean);
  const id = messageId(mail.messageId) || `uid-${uid}-${mail.date?.getTime() ?? 0}`;
  const header = (name: string) => String(mail.headers.get(name) ?? "").toLowerCase();
  const sender = lower(from.address);
  const automated =
    // mailparser gathers List-Unsubscribe, List-Id and their kin under "list".
    mail.headers.has("list") ||
    mail.headers.has("list-unsubscribe") ||
    ["bulk", "list", "junk"].includes(header("precedence")) ||
    (mail.headers.has("auto-submitted") && header("auto-submitted") !== "no") ||
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|newsletter|news|alerts?|billing|invoices?|receipts?|updates?)@/.test(sender) ||
    /(^|[.@])(bounce|bounces|mailer|email\.|e\.|mg\.|sendgrid|amazonses|mailchimp)/.test(sender);
  const recipients = [mail.to, mail.cc].flatMap((list) => (Array.isArray(list) ? list : list ? [list] : [])).flatMap((a) => a.value.map((v) => lower(v.address)));
  return {
    uid,
    id,
    root: references[0] || messageId(mail.inReplyTo) || id,
    from: { address: sender, name: (from.name ?? "").trim() },
    to: recipients,
    subject: (mail.subject ?? "").trim().slice(0, 200),
    text: tidy(mail.text ?? ""),
    date: mail.date ?? new Date(),
    automated,
  };
}

/** What the person wrote, without the thread quoted underneath it. */
function tidy(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^On .{6,120} wrote:\s*$/.test(l.trim()) || /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(l.trim()) || /^From: .+@.+/.test(l.trim()));
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.trim().startsWith(">"));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, BODY_CHARS);
}

async function fetchNew(imap: ImapFlow, folder: string, cursor: Cursor | undefined): Promise<{ messages: Message[]; cursor: Cursor; looked: number }> {
  const box = await imap.mailboxOpen(folder, { readOnly: true });
  const validity = String(box.uidValidity);
  const known = cursor && cursor.validity === validity ? cursor.uid : null;

  let uids: number[];
  if (known === null) {
    // The first read: the last fortnight, so the screen is not empty and the past is not trawled.
    const found = await imap.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000) }, { uid: true });
    uids = (found || []).slice(-PER_SYNC);
  } else {
    const found = await imap.search({ uid: `${known + 1}:*` }, { uid: true });
    // `n:*` always returns the newest message, even when it is older than n.
    uids = (found || []).filter((u) => u > known).slice(0, PER_SYNC);
  }
  if (uids.length === 0) return { messages: [], cursor: { validity, uid: known ?? Math.max(0, Number(box.uidNext) - 1) }, looked: 0 };

  // Sizes first: a message with photographs attached is read only as far as its text.
  const sizes = await imap.fetchAll(uids, { uid: true, size: true }, { uid: true });
  const small = sizes.filter((m) => (m.size ?? 0) <= WHOLE_MESSAGE_BYTES).map((m) => m.uid);
  const large = sizes.filter((m) => (m.size ?? 0) > WHOLE_MESSAGE_BYTES).map((m) => m.uid);

  const sources: { uid: number; source: Buffer }[] = [];
  if (small.length) {
    for (const item of await imap.fetchAll(small, { uid: true, source: true }, { uid: true })) {
      if (item.source) sources.push({ uid: item.uid, source: item.source });
    }
  }
  for (const uid of large) {
    const item = await imap.fetchOne(String(uid), { uid: true, source: { maxLength: LARGE_MESSAGE_HEAD_BYTES } }, { uid: true });
    if (item && item.source) sources.push({ uid, source: item.source });
  }

  const messages: Message[] = [];
  for (const { uid, source } of sources) {
    try {
      const parsed = read(uid, await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true }));
      if (parsed) messages.push(parsed);
    } catch {
      // One message that will not parse is not a reason to stop reading the rest.
    }
  }
  return { messages: messages.sort((a, b) => a.uid - b.uid), cursor: { validity, uid: Math.max(...uids) }, looked: uids.length };
}

const Verdict = z.object({
  customer: z.boolean().describe("True only if a person is writing to the business as a customer or prospective customer"),
  name: z.string().describe("The sender's name if they give it, else an empty string"),
  topic: z.string().describe("What they want, in three to six words"),
  summary: z.string().describe("One sentence: what they asked for or said"),
});

/** Is this someone writing in as a customer? Asked once, of the first message of a thread. */
async function judge(brandName: string, m: Message) {
  const { object } = await generateObject({
    model: languageModel(CHAT_MODEL_ID),
    providerOptions: thinkingOptions("minimal"),
    schema: Verdict,
    system: `You sort the inbox of ${brandName}. Decide whether an email is from a customer or a prospective
customer of the business: an enquiry, a booking or order request, a question, a complaint, feedback, a
request about their account. It is NOT from a customer if it is a newsletter, a receipt or invoice from a
supplier, a notification from a service, a job application, a sales pitch to the business, spam, or
personal mail. When unsure, say it is not.`,
    prompt: `From: ${m.from.name} <${m.from.address}>\nSubject: ${m.subject}\n\n${m.text.slice(0, 1500)}`,
  });
  return object;
}

const threadRef = (root: string) => `email:${createHash("sha1").update(root).digest("hex").slice(0, 32)}`;

async function addTurn(conversationId: string, speaker: "customer" | "human", author: string, body: string, at: Date) {
  // A sync that failed part-way reads the same mail again; a message is on a thread once.
  const [same] = await db
    .select({ id: s.turns.id })
    .from(s.turns)
    .where(and(eq(s.turns.conversationId, conversationId), eq(s.turns.speaker, speaker), eq(s.turns.createdAt, at)))
    .limit(1);
  if (same) return;
  const [last] = await db.select({ ordinal: s.turns.ordinal }).from(s.turns).where(eq(s.turns.conversationId, conversationId)).orderBy(desc(s.turns.ordinal)).limit(1);
  await db.insert(s.turns).values({ conversationId, ordinal: (last?.ordinal ?? -1) + 1, speaker, authorName: author, body, createdAt: at });
}

async function customerByEmail(brandId: string, address: string, name: string) {
  const [known] = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.brandId, brandId), sql`lower(${s.customers.email}) = ${address}`))
    .limit(1);
  if (known) return known;
  const [made] = await db.insert(s.customers).values({ brandId, name: name || address.split("@")[0], email: address, segment: "Email" }).returning();
  return made;
}

/** A message that arrived. Returns whether it was a customer's. */
async function takeIncoming(brand: { id: string; name: string }, box: Mailbox, m: Message) {
  if (m.from.address === box.address || !m.text) return false;
  const ref = threadRef(m.root);
  const [thread] = await db.select().from(s.conversations).where(and(eq(s.conversations.brandId, brand.id), eq(s.conversations.externalRef, ref))).limit(1);
  if (thread) {
    // They wrote again on a thread we hold: it is waiting on the business once more.
    await addTurn(thread.id, "customer", m.from.name || m.from.address, m.text, m.date);
    await db.update(s.conversations).set({ outcome: null, endedAt: null }).where(eq(s.conversations.id, thread.id));
    return true;
  }
  if (m.automated) return false;
  // A colleague on the business's own domain is not a customer.
  const domain = domainOf(m.from.address);
  if (domain === domainOf(box.address) && !PUBLIC_MAIL.has(domain)) return false;

  const verdict = await judge(brand.name, m);
  if (!verdict.customer) return false;

  const customer = await customerByEmail(brand.id, m.from.address, m.from.name || verdict.name);
  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: brand.id,
      customerId: customer.id,
      channel: "email",
      intent: (m.subject || verdict.topic).slice(0, 120),
      // Never "live": nobody is on the line. A thread with no outcome is one still to be answered.
      status: "resolved",
      startedAt: m.date,
      externalRef: ref,
      summary: verdict.summary.slice(0, 400),
    })
    .returning();
  await addTurn(conversation.id, "customer", m.from.name || m.from.address, m.text, m.date);
  return true;
}

/** A message the business sent. Kept only when it answers a customer thread we hold. */
async function takeSent(brandId: string, box: Mailbox, m: Message) {
  if (m.root === m.id || !m.text) return;
  const [thread] = await db.select().from(s.conversations).where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.externalRef, threadRef(m.root)))).limit(1);
  if (!thread) return;
  const who = m.from.name || box.address;
  await addTurn(thread.id, "human", who, m.text, m.date);
  await db
    .update(s.conversations)
    .set({ status: "resolved", outcome: "human_resolved", handledBy: thread.handledBy ?? who, endedAt: m.date })
    .where(eq(s.conversations.id, thread.id));
}

export type SyncResult = { looked: number; kept: number };

/** Read what has arrived since last time. One sync at a time for a mailbox. */
export async function syncMailbox(brand: { id: string; name: string }): Promise<SyncResult | null> {
  // Claim it: only a mailbox nobody is reading, or one whose reader died.
  const [box] = await db
    .update(s.mailboxes)
    .set({ syncingSince: new Date() })
    .where(and(eq(s.mailboxes.brandId, brand.id), sql`(${s.mailboxes.syncingSince} is null or ${s.mailboxes.syncingSince} < ${new Date(Date.now() - STALE_SYNC_MS)})`))
    .returning();
  if (!box) return null;

  let imap: ImapFlow | null = null;
  const cursor = { ...box.cursor };
  let looked = 0;
  let kept = 0;
  try {
    imap = await client(box.host, box.username, unseal(box.secret));
    await imap.connect();

    const inbox = await fetchNew(imap, "INBOX", cursor.inbox);
    looked += inbox.looked;
    for (const m of inbox.messages) {
      if (await takeIncoming(brand, box, m)) kept++;
    }
    cursor.inbox = inbox.cursor;

    // The business's replies, from wherever it sent them.
    const folders = await imap.list();
    const sent = folders.find((f) => f.specialUse === "\\Sent") ?? folders.find((f) => /^(sent|sent items|sent mail)$/i.test(f.name));
    if (sent) {
      const out = await fetchNew(imap, sent.path, cursor.sent);
      for (const m of out.messages) await takeSent(brand.id, box, m);
      cursor.sent = out.cursor;
    }

    await db
      .update(s.mailboxes)
      .set({ cursor, lastSyncedAt: new Date(), syncingSince: null, lastError: null, seen: sql`${s.mailboxes.seen} + ${looked}`, kept: sql`${s.mailboxes.kept} + ${kept}` })
      .where(eq(s.mailboxes.id, box.id));
    return { looked, kept };
  } catch (e) {
    const error = plain(e);
    // Keep what was read before it failed, so the same mail is not judged twice.
    await db.update(s.mailboxes).set({ cursor, lastSyncedAt: new Date(), syncingSince: null, lastError: error.message }).where(eq(s.mailboxes.id, box.id));
    throw error;
  } finally {
    await imap?.logout().catch(() => {});
  }
}

/** Read the inbox if it has not been read lately. For screens to call as they open; never throws. */
export async function syncIfStale(brand: { id: string; name: string }) {
  try {
    const box = await mailboxFor(brand.id);
    if (!box || (box.lastSyncedAt && Date.now() - box.lastSyncedAt.getTime() < FRESH_MS)) return;
    await syncMailbox(brand);
  } catch (e) {
    console.error("[email] sync failed:", (e as Error).message);
  }
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
