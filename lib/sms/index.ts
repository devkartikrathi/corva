import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { seal, unseal } from "@/lib/data/crypto";
import { formatPhone, isPlausiblePhone, phoneDigits } from "@/lib/business/phone";

/**
 * SMS, the same way for every business.
 *
 * In India every SMS goes out from a DLT-registered sender and must match an
 * approved template, so nothing here sends free text: each message is a
 * template for a purpose — a payment link, a confirmed booking, a callback
 * arranged — with its `{#var#}` slots filled in order. The business keeps its
 * own registration and its own provider account; Corva holds the credentials
 * sealed and never shows them back. See docs/TELEPHONY.md, Part 2.
 *
 *   msg91   India. Flow API: the template is chosen by its MSG91 id, the slots
 *           are sent as var1…varN, and MSG91 attaches the DLT ids.
 *   twilio  Elsewhere. The rendered text is sent from `senderId`.
 *   log     Sends nothing; records the message as it would have gone. For
 *           trying the setup before a provider account exists.
 *
 * Not a server action module: anything exported from "use server" is public.
 */

export const SMS_PROVIDERS = ["log", "msg91", "twilio"] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

export const SMS_PURPOSES = [
  {
    key: "payment_link",
    label: "Payment link",
    body: "Dear {#var#}, please pay {#var#} for {#var#} at {#var#} - {#var#}",
    slots: ["customer's name", "amount", "what it is for", "payment link", "business name"],
  },
  {
    key: "booking_confirmed",
    label: "Booking confirmed",
    body: "Your {#var#} with {#var#} is confirmed for {#var#}. Ref {#var#}",
    slots: ["what was booked", "business name", "when", "reference"],
  },
  {
    key: "callback_arranged",
    label: "Callback arranged",
    body: "{#var#} will call you back shortly about {#var#}. - {#var#}",
    slots: ["who will call", "what it is about", "business name"],
  },
  {
    key: "missed_call",
    label: "Missed call",
    body: "Sorry we missed your call. Chat with us on WhatsApp: {#var#} - {#var#}",
    slots: ["WhatsApp link", "business name"],
  },
  {
    key: "order_update",
    label: "Order update",
    body: "Your order {#var#} is {#var#}. - {#var#}",
    slots: ["order reference", "where it has got to", "business name"],
  },
] as const;
export type SmsPurpose = (typeof SMS_PURPOSES)[number]["key"];

/** A DLT variable is at most 30 characters; longer values are cut rather than refused by the operator. */
const VAR_MAX = 30;
/** A URL slot is allowed to be longer (operators whitelist the domain). */
const URL_VAR_MAX = 100;

export class SmsError extends Error {}

/** Fill `{#var#}` slots in order. Missing values become empty; extra ones are ignored. */
export function render(body: string, vars: string[]) {
  let i = 0;
  return body.replace(/\{#var#\}/g, () => {
    const v = (vars[i++] ?? "").replace(/\s+/g, " ").trim();
    return v.slice(0, /^https?:\/\//.test(v) ? URL_VAR_MAX : VAR_MAX);
  });
}
export const slotCount = (body: string) => (body.match(/\{#var#\}/g) ?? []).length;

export async function smsSettingsFor(brandId: string) {
  const [row] = await db.select().from(s.smsSettings).where(eq(s.smsSettings.brandId, brandId)).limit(1);
  return row ?? null;
}

export async function smsTemplatesFor(brandId: string) {
  return db.select().from(s.smsTemplates).where(eq(s.smsTemplates.brandId, brandId));
}

export function recentSms(brandId: string, limit = 12) {
  return db.select().from(s.smsMessages).where(eq(s.smsMessages.brandId, brandId)).orderBy(desc(s.smsMessages.createdAt)).limit(limit);
}

/** Save the provider and sender. Credentials replace the stored ones only when given. */
export async function saveSmsSettings(
  brandId: string,
  input: { provider: string; enabled: boolean; senderId: string; dltEntityId: string; credentials?: Record<string, string> | null },
  by: string,
) {
  if (!SMS_PROVIDERS.includes(input.provider as SmsProvider)) throw new SmsError("Choose a provider.");
  const provider = input.provider as SmsProvider;
  const senderId = input.senderId.trim();
  if (provider === "msg91" && senderId && !/^[A-Za-z]{6}$/.test(senderId)) throw new SmsError("A DLT sender id (header) is six letters, like TMBLDY.");
  const existing = await smsSettingsFor(brandId);
  const creds = input.credentials && Object.values(input.credentials).some((v) => v.trim()) ? seal(JSON.stringify(input.credentials)) : existing?.credentials ?? null;
  if (input.enabled && provider !== "log" && !creds) throw new SmsError("Add the provider's credentials before switching SMS on.");
  if (input.enabled && provider !== "log" && !senderId) throw new SmsError("Add the sender id before switching SMS on.");
  const values = {
    provider,
    enabled: input.enabled,
    senderId: senderId || null,
    dltEntityId: input.dltEntityId.trim() || null,
    credentials: creds,
    updatedByName: by,
    updatedAt: new Date(),
  };
  await db.insert(s.smsSettings).values({ brandId, ...values }).onConflictDoUpdate({ target: s.smsSettings.brandId, set: values });
}

/** Save one purpose's template, exactly as approved on DLT. */
export async function saveSmsTemplate(
  brandId: string,
  input: { purpose: string; body: string; dltTemplateId: string; providerTemplateId: string; enabled: boolean },
) {
  const purpose = SMS_PURPOSES.find((p) => p.key === input.purpose);
  if (!purpose) throw new SmsError("Unknown purpose.");
  const body = input.body.trim();
  if (!body) throw new SmsError("The template needs its words.");
  if (body.length > 1000) throw new SmsError("That template is too long.");
  if (slotCount(body) > purpose.slots.length) throw new SmsError(`This purpose fills ${purpose.slots.length} slots; the template has ${slotCount(body)}.`);
  const values = {
    body,
    dltTemplateId: input.dltTemplateId.trim() || null,
    providerTemplateId: input.providerTemplateId.trim() || null,
    enabled: input.enabled,
    updatedAt: new Date(),
  };
  await db
    .insert(s.smsTemplates)
    .values({ brandId, purpose: purpose.key, ...values })
    .onConflictDoUpdate({ target: [s.smsTemplates.brandId, s.smsTemplates.purpose], set: values });
}

type Settings = NonNullable<Awaited<ReturnType<typeof smsSettingsFor>>>;
type Template = typeof s.smsTemplates.$inferSelect;

async function deliver(settings: Settings, template: Template, to: string, vars: string[], body: string): Promise<{ status: string; id: string | null }> {
  if (settings.provider === "log") return { status: "logged", id: null };
  const creds = settings.credentials ? (JSON.parse(unseal(settings.credentials)) as Record<string, string>) : {};

  if (settings.provider === "msg91") {
    if (!creds.authKey) throw new SmsError("MSG91 auth key is missing.");
    if (!template.providerTemplateId) throw new SmsError("This template has no MSG91 template id.");
    const recipient: Record<string, string> = { mobiles: phoneDigits(to) };
    vars.forEach((v, i) => (recipient[`var${i + 1}`] = render("{#var#}", [v])));
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: creds.authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: template.providerTemplateId, short_url: "0", recipients: [recipient] }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (!res.ok || json?.type === "error") throw new SmsError(json?.message ?? `MSG91 answered ${res.status}.`);
    return { status: "sent", id: json?.message ?? null };
  }

  // twilio
  if (!creds.accountSid || !creds.authToken) throw new SmsError("Twilio account SID and auth token are missing.");
  const from = settings.senderId ?? "";
  const form = new URLSearchParams({ To: `+${phoneDigits(to)}`, Body: body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!res.ok) throw new SmsError(json?.message ?? `Twilio answered ${res.status}.`);
  return { status: "sent", id: json?.sid ?? null };
}

/**
 * Send one SMS for a purpose, if this business has SMS switched on and an
 * enabled template for it. Returns the logged message, or why nothing was
 * sent — a business without SMS is the normal case, not an error.
 */
export async function sendSms(input: {
  brandId: string;
  purpose: SmsPurpose;
  to: string | null | undefined;
  vars: string[];
  customerId?: string | null;
  conversationId?: string | null;
  sentByName?: string | null;
}): Promise<{ sent: true; message: typeof s.smsMessages.$inferSelect } | { sent: false; reason: string }> {
  if (!input.to || !isPlausiblePhone(input.to)) return { sent: false, reason: "no phone number to send to" };
  const settings = await smsSettingsFor(input.brandId);
  if (!settings?.enabled) return { sent: false, reason: "SMS is not switched on for this business" };
  const [template] = await db
    .select()
    .from(s.smsTemplates)
    .where(and(eq(s.smsTemplates.brandId, input.brandId), eq(s.smsTemplates.purpose, input.purpose), eq(s.smsTemplates.enabled, true)))
    .limit(1);
  if (!template) return { sent: false, reason: `no ${input.purpose.replace("_", " ")} template` };

  const to = formatPhone(input.to);
  const body = render(template.body, input.vars);
  let status = "failed";
  let providerMessageId: string | null = null;
  let error: string | null = null;
  try {
    const result = await deliver(settings, template, to, input.vars, body);
    status = result.status;
    providerMessageId = result.id;
  } catch (e) {
    error = e instanceof SmsError ? e.message : (e as Error).name === "TimeoutError" ? "The SMS provider did not answer in time." : "The SMS provider could not be reached.";
    if (!(e instanceof SmsError)) console.error("[sms]", (e as Error).message);
  }
  const [message] = await db
    .insert(s.smsMessages)
    .values({
      brandId: input.brandId,
      customerId: input.customerId ?? null,
      conversationId: input.conversationId ?? null,
      to,
      purpose: input.purpose,
      body,
      provider: settings.provider,
      status,
      providerMessageId,
      error,
      sentByName: input.sentByName ?? null,
    })
    .returning();
  return error ? { sent: false, reason: error } : { sent: true, message };
}
