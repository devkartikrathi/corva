import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { Proposal } from "@/lib/agent/proposals";
import { phoneDigits } from "@/lib/business/phone";
import { seal, unseal } from "@/lib/data/crypto";
import { DataSourceError } from "@/lib/data/postgres";
import { ApiError } from "@/lib/integrations/api";
import { agentChat, agentChatConfirm } from "@/lib/integrations/intake";
import { allowAll } from "@/lib/rate-limit";

/**
 * WhatsApp, through Meta's WhatsApp Cloud API.
 *
 * The business connects its own number: it owns the Meta app, and gives Corva
 * the number's id, an access token and the app secret. From then on a message
 * to that number is answered by the business's assistant exactly as a website
 * chat is — same knowledge, same details to collect, same bookings — and lands
 * in the same Conversations, on the same customer. When a person takes the
 * chat over in the console, what they type is sent to the customer's WhatsApp.
 *
 * Corva only ever replies to a customer who wrote first, inside WhatsApp's
 * 24-hour window. It does not start conversations, so no message templates
 * are involved.
 */

export class WhatsAppError extends DataSourceError {}

type NumberRow = typeof s.whatsappNumbers.$inferSelect;
type Brand = typeof s.brands.$inferSelect;

const GRAPH = () => `${process.env.WHATSAPP_GRAPH_URL ?? "https://graph.facebook.com"}/${process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0"}`;

/** A chat that has been quiet this long is finished; the next message starts a new one. */
const SAME_CHAT_MS = 24 * 3_600_000;
const MAX_TEXT = 4000;

async function graph(path: string, token: string, init?: { method?: string; body?: unknown }) {
  let res: Response;
  try {
    res = await fetch(`${GRAPH()}/${path}`, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatsAppError("Could not reach WhatsApp. Try again in a moment.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok) {
    const reason = json.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || json.error?.code === 190) throw new WhatsAppError("WhatsApp refused the access token. It may have expired: make a permanent one and connect again.");
    throw new WhatsAppError(`WhatsApp said: ${reason.slice(0, 200)}`);
  }
  return json;
}

/* ─── Connecting ───────────────────────────────────────────────────────── */

export async function whatsappFor(brandId: string) {
  const [row] = await db.select().from(s.whatsappNumbers).where(eq(s.whatsappNumbers.brandId, brandId)).limit(1);
  return row ?? null;
}

/** Connect a number: prove the id and token belong together, and keep them sealed. */
export async function connectWhatsApp(brandId: string, input: { phoneNumberId: string; token: string; appSecret: string }, by: string) {
  const phoneNumberId = input.phoneNumberId.trim();
  const token = input.token.trim();
  const appSecret = input.appSecret.trim();
  if (!/^\d{8,20}$/.test(phoneNumberId)) throw new WhatsAppError("The phone number ID is a long number from Meta's WhatsApp setup page, not the phone number itself.");
  if (token.length < 40) throw new WhatsAppError("Paste the access token from Meta.");
  if (!/^[0-9a-f]{32}$/i.test(appSecret)) throw new WhatsAppError("The app secret is 32 letters and digits, under App settings → Basic in Meta.");

  const [taken] = await db.select({ brandId: s.whatsappNumbers.brandId }).from(s.whatsappNumbers).where(eq(s.whatsappNumbers.phoneNumberId, phoneNumberId)).limit(1);
  if (taken && taken.brandId !== brandId) throw new WhatsAppError("That number is already connected to another business.");

  const info = (await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, token)) as { display_phone_number?: string; verified_name?: string };
  if (!info.display_phone_number) throw new WhatsAppError("That ID is not a WhatsApp phone number this token can use.");

  const existing = await whatsappFor(brandId);
  const values = {
    phoneNumberId,
    displayNumber: info.display_phone_number,
    verifiedName: info.verified_name ?? null,
    token: seal(token),
    appSecret: seal(appSecret),
    lastError: null,
  };
  const [row] = existing
    ? await db.update(s.whatsappNumbers).set(values).where(eq(s.whatsappNumbers.id, existing.id)).returning()
    : await db
        .insert(s.whatsappNumbers)
        .values({ brandId, createdByName: by, verifyToken: `corva_${randomBytes(18).toString("base64url")}`, ...values })
        .returning();
  return row;
}

export async function disconnectWhatsApp(brandId: string) {
  const [row] = await db.delete(s.whatsappNumbers).where(eq(s.whatsappNumbers.brandId, brandId)).returning();
  return row ?? null;
}

/** Meta checking the webhook address: echo its challenge if the token is one of ours. */
export async function verifyWebhook(token: string | null) {
  if (!token) return false;
  const [row] = await db.update(s.whatsappNumbers).set({ verifiedAt: new Date() }).where(eq(s.whatsappNumbers.verifyToken, token)).returning({ id: s.whatsappNumbers.id });
  return Boolean(row);
}

/* ─── Sending ──────────────────────────────────────────────────────────── */

const clipText = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

async function send(number: NumberRow, to: string, message: Record<string, unknown>) {
  try {
    await graph(`${number.phoneNumberId}/messages`, unseal(number.token), {
      method: "POST",
      body: { messaging_product: "whatsapp", recipient_type: "individual", to, ...message },
    });
  } catch (e) {
    await db.update(s.whatsappNumbers).set({ lastError: (e as Error).message.slice(0, 240) }).where(eq(s.whatsappNumbers.id, number.id));
    throw e;
  }
}

const sendText = (number: NumberRow, to: string, text: string) => send(number, to, { type: "text", text: { body: clipText(text), preview_url: false } });

/** The details of a booking or callback, as the customer should check them. */
function proposalText(p: Proposal) {
  const d = p.details as Record<string, unknown>;
  const lines: [string, unknown][] =
    p.kind === "booking"
      ? [["Name", d.name], ["For", Array.isArray(d.services) ? d.services.join(", ") : d.services], ["When", [d.date, d.timeSlot].filter(Boolean).join(", ")], ["Address", d.address], ["Notes", d.notes], ["Promo code", d.promoCode]]
      : [["Name", d.name], ["Best time", d.preferredTime], ["About", d.topic], ["Email", d.email]];
  const body = [...lines, ...(p.extra ?? []).map((e) => [e.label, e.value] as [string, unknown])]
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `*${k}:* ${v}`)
    .join("\n");
  return `Please check your ${p.noun}:\n\n${body}`.slice(0, 1000);
}

/** A booking or callback to confirm: the details, with Confirm and Change underneath. */
const sendProposal = (number: NumberRow, to: string, p: Proposal) =>
  send(number, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: proposalText(p) },
      action: {
        buttons: [
          { type: "reply", reply: { id: `confirm:${p.id}`, title: "Confirm" } },
          { type: "reply", reply: { id: `edit:${p.id}`, title: "Change" } },
        ],
      },
    },
  });

/**
 * What a person typed in the console, sent to the customer's WhatsApp.
 * Throws when it cannot be delivered, so the person knows it did not arrive.
 */
export async function deliverHumanReply(conversation: { brandId: string; channel: string; externalRef: string | null }, text: string) {
  if (conversation.channel !== "whatsapp") return;
  const to = conversation.externalRef?.match(/^agent:wa-(\d+)-/)?.[1];
  const number = await whatsappFor(conversation.brandId);
  if (!to || !number) throw new WhatsAppError("This business's WhatsApp is no longer connected, so the reply could not be sent.");
  await sendText(number, to, text);
}

/* ─── Receiving ────────────────────────────────────────────────────────── */

/** Whether a webhook body was signed with this app secret. */
export function signedBy(secret: string, raw: string, header: string | null) {
  const given = header?.startsWith("sha256=") ? header.slice(7) : "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

type Inbound = {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
};
type Change = { value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: Inbound[] } };
export type WebhookBody = { object?: string; entry?: { changes?: Change[] }[] };

/** The numbers a webhook is about, so its signature can be checked before anything in it is trusted. */
export async function numbersIn(body: WebhookBody) {
  const ids = [...new Set((body.entry ?? []).flatMap((e) => e.changes ?? []).map((c) => c.value?.metadata?.phone_number_id).filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return [];
  return db.select().from(s.whatsappNumbers).where(inArray(s.whatsappNumbers.phoneNumberId, ids));
}

const UNREADABLE: Record<string, string> = { image: "a photo", audio: "a voice note", video: "a video", document: "a document", sticker: "a sticker", location: "a location", contacts: "a contact" };

/** The chat this customer is in, or a new one if the last went quiet. */
async function sessionFor(brandId: string, from: string) {
  const [open] = await db
    .select({ ref: s.conversations.externalRef })
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.brandId, brandId),
        eq(s.conversations.channel, "whatsapp"),
        like(s.conversations.externalRef, `agent:wa-${from}-%`),
        inArray(s.conversations.status, ["live", "waiting_human"]),
        gte(s.conversations.startedAt, new Date(Date.now() - SAME_CHAT_MS)),
      ),
    )
    .orderBy(desc(s.conversations.startedAt))
    .limit(1);
  return open?.ref?.slice("agent:".length) ?? `wa-${from}-${Date.now().toString(36)}`;
}

async function answer(number: NumberRow, brand: Brand, m: Inbound, name: string | undefined) {
  const from = phoneDigits(m.from);
  if (!from) return;
  const session = await sessionFor(brand.id, from);

  // A tap on Confirm or Change under a booking.
  const tapped = m.interactive?.button_reply?.id?.match(/^(confirm|edit):([0-9a-f-]{36})$/i);
  if (tapped) {
    try {
      const result = await agentChatConfirm(brand, { sessionId: session, proposalId: tapped[2], approved: tapped[1] === "confirm" });
      if (result.reply) await sendText(number, from, result.reply);
    } catch (e) {
      // An old card, or a chat that has since ended: say so rather than nothing.
      await sendText(number, from, e instanceof ApiError ? e.message : "That could not be done just now. Please tell me again what you would like.");
    }
    return;
  }

  const text =
    m.text?.body?.trim() ||
    m.button?.text?.trim() ||
    m.interactive?.button_reply?.title ||
    m.interactive?.list_reply?.title ||
    `(The customer sent ${UNREADABLE[m.type] ?? "something"} on WhatsApp, which you cannot open. Say so, and ask them to type what they need.)`;

  let reply: Awaited<ReturnType<typeof agentChat>>;
  try {
    reply = await agentChat(brand, { sessionId: session, message: text.slice(0, 2000), customer: { phone: `+${from}`, name }, channel: "whatsapp" });
  } catch (e) {
    // The plan has no room, or the chat ended between the lookup and now.
    if (e instanceof ApiError && e.status === 402) await sendText(number, from, e.message);
    else throw e;
    return;
  }
  if (reply instanceof Response) return;
  // Held by a person: their reply goes out when they type it.
  if (reply.reply) await sendText(number, from, reply.reply);
  if (reply.proposal && "kind" in reply.proposal) await sendProposal(number, from, reply.proposal as Proposal);
}

/** Take a verified webhook: answer each new message, once. */
export async function receive(body: WebhookBody, numbers: NumberRow[]) {
  for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
    const value = change.value;
    const number = numbers.find((n) => n.phoneNumberId === value?.metadata?.phone_number_id);
    if (!number || !value?.messages?.length) continue;
    const [brand] = await db.select().from(s.brands).where(eq(s.brands.id, number.brandId)).limit(1);
    if (!brand) continue;
    await db.update(s.whatsappNumbers).set({ lastInboundAt: new Date(), lastError: null }).where(eq(s.whatsappNumbers.id, number.id));

    for (const m of value.messages) {
      // Meta sends the same message again if it is not sure we got it.
      const [fresh] = await db.insert(s.whatsappSeen).values({ messageId: m.id }).onConflictDoNothing().returning();
      if (!fresh) continue;
      // A sender past the limit is not answered and not told: telling them is another message.
      if (!(await allowAll([[`wa:${number.id}:${m.from}`, 12, 60], [`wa:${number.id}:${m.from}`, 200, 86_400]]))) continue;
      const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
      try {
        // Blue ticks: the customer sees their message was read.
        void graph(`${number.phoneNumberId}/messages`, unseal(number.token), { method: "POST", body: { messaging_product: "whatsapp", status: "read", message_id: m.id } }).catch(() => {});
        await answer(number, brand, m, name);
      } catch (e) {
        console.error("[whatsapp]", brand.name, (e as Error).message);
      }
    }
  }
}

/** WhatsApp conversations on record, newest first. */
export async function whatsappThreads(brandId: string, limit = 30) {
  return db
    .select({
      id: s.conversations.id,
      status: s.conversations.status,
      handledBy: s.conversations.handledBy,
      summary: s.conversations.summary,
      intent: s.conversations.intent,
      startedAt: s.conversations.startedAt,
      customerName: s.customers.name,
      customerPhone: s.customers.phone,
    })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.channel, "whatsapp")))
    .orderBy(desc(s.conversations.startedAt))
    .limit(limit);
}
