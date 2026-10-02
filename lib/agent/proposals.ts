import { tool, type ToolSet } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { isPlausiblePhone } from "@/lib/business/phone";
import { industryFor, type Industry } from "@/lib/business/industries";
import { captureDetails, labelled, type IntakeField } from "@/lib/business/intake";

/**
 * Bookings and callbacks a customer confirms themselves.
 *
 * In a web chat the agent does not book anything on its own say-so. It
 * collects the details, proposes them, and the website shows a card with
 * Confirm and Edit; only Confirm makes the lead, the follow-up and the emails.
 * That keeps a misheard date or a half-typed number from becoming a promise
 * the team has to unpick, and it is the same step a person at a counter takes:
 * "so that's Saturday morning, 8 to 10, at B-402 — shall I book it?"
 *
 * The phone line has no card to tap, so it keeps recording leads as it goes
 * (see lib/crm/capture.ts). These tools are only offered where a card can be
 * shown — the chat API.
 */

export type BookingDetails = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  services: string[];
  date: string;
  timeSlot: string;
  notes?: string;
  promoCode?: string;
};

export type CallbackDetails = {
  name: string;
  phone: string;
  email: string;
  preferredTime?: string;
  topic?: string;
};

/** The business's other Details to collect, as found out so far — shown on the card too. */
export type ProposalExtra = { label: string; value: string }[];

export type Proposal =
  | { id: string; kind: "booking"; noun: string; details: BookingDetails; extra?: ProposalExtra }
  | { id: string; kind: "callback"; noun: "callback"; details: CallbackDetails; extra?: ProposalExtra };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const todayIST = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/** Why these details cannot be booked yet, or null when they can. */
export function checkBooking(d: BookingDetails, booking: NonNullable<Industry["booking"]>): string | null {
  if ((d.name ?? "").trim().length < 2) return "The customer's name is missing.";
  if (!isPlausiblePhone(d.phone ?? "")) return "The phone number is not a valid mobile number.";
  if (booking.needsAddress && (d.address ?? "").trim().length < 10)
    return "The address is too short — it needs the house or flat, the building or society, and the area.";
  if (!d.services?.filter((x) => x.trim()).length) return "What they need done is missing.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) return "The date must be YYYY-MM-DD.";
  const parsed = new Date(`${d.date}T00:00:00Z`);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d.date) return "That date does not exist.";
  const today = todayIST();
  if (d.date < today) return "That date is in the past.";
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + booking.maxDaysAhead);
  if (d.date > max.toISOString().slice(0, 10)) return `Bookings can be made at most ${booking.maxDaysAhead} days ahead.`;
  if (!(d.timeSlot ?? "").trim()) return "The time slot is missing.";
  if (d.email && !EMAIL.test(d.email.trim())) return "The email address does not look right.";
  return null;
}

export function checkCallback(d: CallbackDetails): string | null {
  if ((d.name ?? "").trim().length < 2) return "The customer's name is missing.";
  if (!isPlausiblePhone(d.phone ?? "")) return "The phone number is not a valid mobile number.";
  if (!d.email || !EMAIL.test(d.email.trim())) return "An email address is needed — the confirmation is emailed.";
  return null;
}

/** Whether a collected detail only repeats the booking's own date or time slot. */
function restatesWhen(value: string, details: BookingDetails | CallbackDetails): boolean {
  if (!("date" in details)) return false;
  const digits = (t: string) => t.replace(/\D/g, "");
  const slot = digits(details.timeSlot ?? "");
  return value.includes(details.date) || (slot.length >= 2 && digits(value).includes(slot));
}

/** Drop empty optional fields, trim the rest, so the card shows only what was said. */
function tidy<T extends Record<string, unknown>>(d: T): T {
  return Object.fromEntries(
    Object.entries(d)
      .map(([k, v]) => [k, typeof v === "string" ? v.trim() : Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : v])
      .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as T;
}

/** What the model is told to do, when these tools are on offer. */
export function proposalInstructions(industryKey: string | null | undefined, agentName: string): string {
  const booking = industryFor(industryKey).booking;
  const noun = booking?.noun ?? "booking";
  return `Booking and callbacks in this chat
The customer can confirm requests on a card in this chat.${
    booking
      ? `
- propose_booking books a ${noun}. Needed: name, mobile number,${booking.needsAddress ? " full address," : ""} what they need done, date and time slot. Optional: email, notes, offer code.`
      : ""
  }
- propose_callback asks the team to phone them back — for prices you do not have, bulk orders, or anything you cannot answer. Needed: name, mobile number and email (the confirmation is emailed). Optional: preferred time, topic.

How to collect:
1. Take every detail they have already given, even from one messy message. Never ask again for something you have — including anything in "What you know about this customer".
2. Ask for everything still missing in ONE short message, as a bullet list.
3. Turn relative dates ("tomorrow", "this Saturday") into YYYY-MM-DD using today's date above. If they give no time, ask; "anytime" is a valid slot.
4. Once you have everything, call the tool straight away — do not ask "shall I book it?" first. The card is where they confirm.
5. The card shows the details, so do not repeat them. Say one short line at most, e.g. "Please check the details and tap Confirm."
6. If the tool says something is wrong, ask for just that detail.
7. Use these instead of schedule_follow_up for a callback the customer asks for.
Never say something is booked — the confirmation comes after they tap Confirm, and ${agentName} does not need to add anything then.`;
}

/**
 * The two tools, bound to one conversation.
 *
 * Proposing writes a pending row (and retires any earlier pending one, since
 * only the latest card can be answered) and tells the model to stop talking.
 */
export function proposalTools(opts: {
  brandId: string;
  conversationId: string;
  industry: string | null | undefined;
  fields: IntakeField[];
  onPropose: (p: Proposal) => void;
}): ToolSet {
  const booking = industryFor(opts.industry).booking;

  /**
   * What the card says is what was found out: its name, number, email and
   * address go into the conversation's details, and the business's other
   * details found so far ride along on the card.
   */
  async function extraFor(details: BookingDetails | CallbackDetails): Promise<ProposalExtra | undefined> {
    const address = opts.fields.find((f) => f.kind === "address");
    const { captured } = await captureDetails(opts.conversationId, opts.fields, {
      name: details.name,
      phone: details.phone,
      email: details.email,
      ...(address && "address" in details && details.address ? { [address.key]: details.address } : {}),
    });
    const shown = new Set(Object.values(details).flat().map((v) => String(v).toLowerCase()));
    const extra = labelled(
      opts.fields.filter((f) => !f.builtIn && f.kind !== "address"),
      (captured ?? {}) as Record<string, string>,
    )
      .filter((e) => !shown.has(e.value.toLowerCase()))
      // "Tomorrow 9–11" under a card that already says when is the same fact twice.
      .filter((e) => !restatesWhen(e.value, details));
    return extra.length ? extra.map(({ label, value }) => ({ label, value })) : undefined;
  }

  async function save(kind: "booking" | "callback", details: BookingDetails | CallbackDetails) {
    await db
      .update(s.chatProposals)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(and(eq(s.chatProposals.conversationId, opts.conversationId), eq(s.chatProposals.status, "pending")));
    const [row] = await db
      .insert(s.chatProposals)
      .values({ brandId: opts.brandId, conversationId: opts.conversationId, kind, details })
      .returning({ id: s.chatProposals.id });
    return row.id;
  }

  const propose_callback = tool({
    description:
      "Offer the customer a callback from the team. They confirm it on a card. Call once you have their name, mobile number and email.",
    inputSchema: z.object({
      name: z.string().describe("Their name"),
      phone: z.string().describe("Their mobile number"),
      email: z.string().describe("Their email — the confirmation goes here"),
      preferredTime: z.string().optional().describe("When they would like the call, e.g. 'today after 6 PM'"),
      topic: z.string().optional().describe("What they want to talk about, in a few words"),
    }),
    execute: async (input) => {
      const details = tidy(input) as CallbackDetails;
      const problem = checkCallback(details);
      if (problem) return { proposed: false, problem };
      const id = await save("callback", details);
      opts.onPropose({ id, kind: "callback", noun: "callback", details, extra: await extraFor(details) });
      return { proposed: true, next: "The customer now sees a card to confirm. Do not repeat the details." };
    },
  });

  if (!booking) return { propose_callback };

  const propose_booking = tool({
    description: `Offer to book a ${booking.noun}. They confirm it on a card. Call only once every required detail is known.`,
    inputSchema: z.object({
      name: z.string().describe("Their name"),
      phone: z.string().describe("Their mobile number"),
      address: booking.needsAddress
        ? z.string().describe("Full address: house or flat, building or society, sector or area")
        : z.string().optional(),
      services: z.array(z.string()).describe("What they need done, using the business's own service names"),
      date: z.string().describe("The date, YYYY-MM-DD"),
      timeSlot: z.string().describe("Preferred time window, e.g. '8–10 AM', 'evening', 'anytime'"),
      email: z.string().optional().describe("Email, only if they gave one"),
      notes: z.string().optional().describe("Item details or special instructions"),
      promoCode: z.string().optional().describe("An offer code they mentioned"),
    }),
    execute: async (input) => {
      const details = tidy(input) as BookingDetails;
      const problem = checkBooking(details, booking);
      if (problem) return { proposed: false, problem };
      const id = await save("booking", details);
      opts.onPropose({ id, kind: "booking", noun: booking.noun, details, extra: await extraFor(details) });
      return { proposed: true, next: "The customer now sees a card to confirm. Do not repeat the details." };
    },
  });

  return { propose_booking, propose_callback };
}

/** The latest proposal still waiting on this conversation, if any. */
export async function pendingProposal(conversationId: string) {
  const [row] = await db
    .select()
    .from(s.chatProposals)
    .where(and(eq(s.chatProposals.conversationId, conversationId), eq(s.chatProposals.status, "pending")))
    .orderBy(desc(s.chatProposals.createdAt))
    .limit(1);
  return row ?? null;
}
