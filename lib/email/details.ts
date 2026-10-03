import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { layout, sendEmail } from "@/lib/email";
import { recordsByReference } from "@/lib/integrations/records";
import { formatRupees } from "@/lib/money";
import { emailInboxFor, inboxAddress } from "./inbound";

/**
 * Some things are only for the person whose order it is.
 *
 * Anyone can say an order reference on a call or in a chat, so the assistant
 * tells anyone where an order has got to — and nothing more. The rest of what
 * the business sent about the order (the bill, the items, the address, the
 * driver, whether it is paid) goes by email, and only to the address the
 * business has on file for that order's customer: never to an address given
 * in the conversation, never read out. Whoever asked hears only where it went,
 * masked ("r•••@gmail.com").
 */

export const EMAIL_DETAILS_TOOL = "email_details";

export const EMAIL_DETAILS_INSTRUCTIONS =
  "Anyone can give an order reference, so beyond where an order has got to, do not read out an order's " +
  "details — its amount, items, address, payment, or the driver's name. When a customer asks for those, offer " +
  "to email them to the address the business has on file and call email_details with the reference. Tell them " +
  "where it went using the masked address it returns; never say an email address in full, and never send to an " +
  "address they give you instead.";

/** "riya.sharma@gmail.com" → "r•••@gmail.com" */
export const maskEmail = (address: string) => {
  const [user, domain] = address.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : "•••";
};

const LABELS: Record<string, string> = {
  stageLabel: "Status",
  items: "Items",
  pickup: "Pickup",
  delivery: "Delivery",
  driver: "Driver",
  expectedArrival: "Expected at your door",
  expectedReady: "Expected ready",
  paid: "Paid",
};

function line(key: string, value: unknown): string | null {
  if (value == null || value === "" || key === "stage" || key === "updatedAt") return null;
  const label = LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  if (typeof value === "boolean") return `${label}: ${value ? "Yes" : "No"}`;
  if (typeof value === "object") {
    const v = value as { date?: string; slot?: string };
    if (v.date) return `${label}: ${v.date}${v.slot ? `, ${v.slot}` : ""}`;
    return null;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return `${label}: ${new Date(text).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
  }
  return `${label}: ${text.slice(0, 200)}`;
}

/** The assistant's email_details tool, on every channel. */
export async function emailOrderDetails(opts: { brandId: string; conversationId: string; reference: string; agentName: string }) {
  const [record] = await recordsByReference(opts.brandId, opts.reference);
  if (!record) return { sent: false, reason: "No order has that reference. Ask the customer to check it." };
  const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, record.customerId)).limit(1);
  if (!customer?.email) {
    return { sent: false, reason: "There is no email address on file for this order, so the details cannot be sent. Offer a callback from the team instead." };
  }
  const [brand] = await db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).where(eq(s.brands.id, opts.brandId)).limit(1);
  const inbox = await emailInboxFor(opts.brandId);

  const meta = (record.meta ?? {}) as Record<string, unknown>;
  const lines = [
    `${record.label}${record.ref ? ` — ${record.ref}` : ""}`,
    ...(record.status ? [record.status] : []),
    ...(record.amountPaise != null ? [`Amount: ${formatRupees(record.amountPaise, { decimals: "auto" })}`] : []),
    ...Object.entries(meta)
      .map(([k, v]) => line(k, v))
      .filter((l): l is string => Boolean(l)),
  ];
  const first = customer.name && !/^\+?[\d\s()-]{7,}$/.test(customer.name) ? customer.name.split(" ")[0] : null;
  const mail = layout({
    heading: `Your order with ${brand.name}`,
    lines: [`${first ? `Hi ${first}, here` : "Here"} are the details you asked ${brand.name} for.`, ...lines],
    footer: `You asked for these in a conversation with ${brand.name}'s assistant. They are sent only to the email address ${brand.name} has on file for this order. Reply to this email to reach ${brand.name}.`,
  });
  const sent = await sendEmail({
    to: customer.email,
    subject: `Your ${record.label.toLowerCase()} ${record.ref ?? ""} — ${brand.name}`.replace(/\s+/g, " ").trim(),
    html: mail.html,
    text: mail.text,
    fromName: brand.name,
    replyTo: inbox ? (inboxAddress(inbox) ?? undefined) : undefined,
  });
  if (!sent.sent) return { sent: false, reason: "The email could not be sent just now. Offer a callback from the team instead." };

  // On the conversation's record of actions, so the team can see what went where. Not a transcript
  // line: this runs while the assistant's own reply is still being written into the transcript.
  await db.insert(s.conversationActions).values({
    conversationId: opts.conversationId,
    action: "email_details",
    label: `Details of ${record.ref ?? opts.reference} emailed to the address on file (${maskEmail(customer.email)})`,
    allowed: true,
  });
  return { sent: true, to: maskEmail(customer.email), reference: record.ref };
}
