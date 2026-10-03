import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatPhone, phoneDigits } from "@/lib/business/phone";
import { layout, sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

/**
 * Proving who someone is, with a code. For every business.
 *
 * The code goes only to the number or email already on the customer's record
 * — never to one typed in the conversation — so entering it proves the person
 * in the conversation controls that number or email. The model never sees the
 * code: only its HMAC is stored, the assistant is told where it went
 * ("r•••@gmail.com"), and it passes on what the customer typed for code to
 * check. Ten minutes, five tries, three codes per conversation an hour, six
 * per number or email a day. A right code makes the conversation verified
 * (`identified_by = "otp"`). See docs/PAYMENTS-AND-VERIFICATION.md.
 */

const LIFETIME_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PER_CONVERSATION_HOUR = 3;
const PER_DESTINATION_DAY = 6;

function hash(codeId: string, code: string) {
  const key = process.env.DATA_SOURCE_KEY || process.env.CRON_SECRET;
  if (!key) throw new Error("Verification is not configured (DATA_SOURCE_KEY).");
  return createHmac("sha256", `${key}:verify`).update(`${codeId}:${code}`).digest("hex");
}

export const maskPhone = (phone: string) => {
  const d = phoneDigits(phone);
  return `•••••${d.slice(-4)}`;
};
const maskEmail = (address: string) => {
  const [user, domain] = address.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : "•••";
};

/** Where a code could go for the customer this conversation is with. */
async function subjectOf(conversationId: string) {
  const [row] = await db
    .select({ conversation: s.conversations, customer: s.customers, brandName: s.brands.name })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  return row ?? null;
}

/**
 * Send a code to the customer's number (SMS) or email on file. `via` is a
 * preference; the other is used when there is no such handle on file.
 */
export async function sendVerificationCode(conversationId: string, via: "sms" | "email" | "any" = "any") {
  const row = await subjectOf(conversationId);
  if (!row?.customer) return { sent: false as const, reason: "We do not know who this is yet. Ask for their name and the number or email they gave the business before." };
  const { conversation, customer, brandName } = row;

  const options: ("sms" | "email")[] = via === "sms" ? ["sms", "email"] : via === "email" ? ["email", "sms"] : customer.phone ? ["sms", "email"] : ["email", "sms"];
  const since = new Date(Date.now() - 3_600_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.verificationCodes)
    .where(and(eq(s.verificationCodes.conversationId, conversationId), gte(s.verificationCodes.createdAt, since)));
  if ((recent?.n ?? 0) >= PER_CONVERSATION_HOUR) return { sent: false as const, reason: "Several codes have been sent already. Ask them to use the latest one, or offer that the team will help." };

  const reasons: string[] = [];
  for (const channel of options) {
    const destination = channel === "sms" ? (customer.phone ? phoneDigits(customer.phone) : null) : customer.email?.toLowerCase() ?? null;
    if (!destination) {
      reasons.push(channel === "sms" ? "no number on file" : "no email on file");
      continue;
    }
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.verificationCodes)
      .where(and(eq(s.verificationCodes.brandId, conversation.brandId), eq(s.verificationCodes.destination, destination), gte(s.verificationCodes.createdAt, new Date(Date.now() - 86_400_000))));
    if ((today?.n ?? 0) >= PER_DESTINATION_DAY) {
      reasons.push(`too many codes to that ${channel === "sms" ? "number" : "address"} today`);
      continue;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const id = crypto.randomUUID();
    let delivered: { ok: boolean; reason?: string };
    if (channel === "sms") {
      const r = await sendSms({
        brandId: conversation.brandId,
        purpose: "otp",
        to: formatPhone(destination),
        vars: [code, brandName],
        customerId: customer.id,
        conversationId,
        sentByName: "Corva (verification)",
        secret: code,
      });
      // In SMS test mode nothing reaches the phone: that is not a code sent.
      delivered = r.sent && r.message.status !== "logged" ? { ok: true } : { ok: false, reason: r.sent ? "SMS is in test mode" : r.reason };
    } else {
      const mail = layout({
        heading: `Your code for ${brandName}`,
        lines: [`${code} is your verification code for ${brandName}.`, "Type it into your conversation with us. It expires in 10 minutes.", "If you did not ask for it, ignore this email: nothing happens without the code."],
        footer: `Sent for ${brandName} by Corva. Nobody from ${brandName} will ever ask you to read this code out.`,
      });
      const r = await sendEmail({ to: destination, subject: `${code} is your ${brandName} code`, html: mail.html, text: mail.text, fromName: brandName });
      delivered = r.sent ? { ok: true } : { ok: false, reason: r.reason ?? "email could not be sent" };
    }
    if (!delivered.ok) {
      reasons.push(`${channel}: ${delivered.reason}`);
      continue;
    }
    await db.insert(s.verificationCodes).values({
      id,
      brandId: conversation.brandId,
      conversationId,
      customerId: customer.id,
      channel,
      destination,
      codeHash: hash(id, code),
      expiresAt: new Date(Date.now() + LIFETIME_MS),
    });
    return { sent: true as const, channel, to: channel === "sms" ? maskPhone(destination) : maskEmail(destination) };
  }
  return { sent: false as const, reason: `A code could not be sent (${reasons.join("; ")}). Offer that the team will help instead.` };
}

/** Check what the customer typed. A right code makes the conversation verified. */
export async function verifyCode(conversationId: string, typed: string) {
  const code = typed.replace(/\D/g, "");
  const [latest] = await db
    .select()
    .from(s.verificationCodes)
    .where(and(eq(s.verificationCodes.conversationId, conversationId), isNull(s.verificationCodes.verifiedAt)))
    .orderBy(desc(s.verificationCodes.createdAt))
    .limit(1);
  if (!latest) return { verified: false as const, reason: "No code has been sent in this conversation. Send one first." };
  if (latest.expiresAt < new Date()) return { verified: false as const, reason: "That code has expired. Offer to send a new one." };
  if (latest.attempts >= MAX_ATTEMPTS) return { verified: false as const, reason: "Too many wrong tries for this code. Offer to send a new one, or the team's help." };

  await db.update(s.verificationCodes).set({ attempts: latest.attempts + 1 }).where(eq(s.verificationCodes.id, latest.id));
  const expected = Buffer.from(latest.codeHash, "hex");
  const given = Buffer.from(hash(latest.id, code.length === 6 ? code : "x"), "hex");
  if (code.length !== 6 || !timingSafeEqual(expected, given)) {
    const left = MAX_ATTEMPTS - latest.attempts - 1;
    return { verified: false as const, reason: left > 0 ? `That is not the code. ${left} tr${left === 1 ? "y" : "ies"} left.` : "That is not the code, and that was the last try. Offer to send a new one." };
  }

  await db.update(s.verificationCodes).set({ verifiedAt: new Date() }).where(eq(s.verificationCodes.id, latest.id));
  // Proven: this conversation is with the customer whose number or email it is.
  await db
    .update(s.conversations)
    .set({ identifiedBy: "otp" })
    .where(and(eq(s.conversations.id, conversationId), eq(s.conversations.customerId, latest.customerId)));
  await db
    .update(s.customerIdentities)
    .set({ verified: true, lastSeenAt: new Date() })
    .where(and(eq(s.customerIdentities.customerId, latest.customerId), eq(s.customerIdentities.kind, latest.channel === "sms" ? "phone" : "email"), eq(s.customerIdentities.value, latest.destination)));
  return { verified: true as const };
}

/** Whether this conversation has proven who it is with (any verified channel, or a code). */
export async function isConversationVerified(conversationId: string) {
  const [row] = await db.select({ by: s.conversations.identifiedBy }).from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  const { isVerified } = await import("@/lib/crm/identity");
  return isVerified(row?.by);
}

/** The paragraph both the chat and the voice assistant are given about codes. */
export const VERIFY_INSTRUCTIONS =
  "To prove a customer is who they say they are (for example before taking payment), call send_verification_code. " +
  "It sends a 6-digit code to the number or email the business already has for them — never to one they give you — and tells you " +
  "where it went; say that. When they tell you the code, call verify_code with exactly what they typed. This is the business's own " +
  "code: it is fine to ask for it. Never ask for a code from a bank, a card or a payment app, and never say the code yourself.";
