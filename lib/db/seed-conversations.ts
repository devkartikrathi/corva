/**
 * Seeds conversations, turns, citations, actions and handoffs.
 *
 * Separate from the main seed because it depends on customers and documents
 * already existing, and because it is the part you re-run when you want a
 * fresh queue to work through.
 */
import "./script-env";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

type Turn = {
  speaker: "customer" | "ai" | "human";
  body: string;
  at?: number;
  author?: string;
  /** Document title to cite, plus the policy check that passed. */
  cite?: string;
  check?: string;
  sentiment?: number;
};

type Seed = {
  customerRef: string;
  channel: "phone" | "whatsapp" | "web_chat" | "email" | "sms" | "survey";
  intent: string;
  status: "live" | "waiting_human" | "resolved";
  outcome?: "ai_resolved" | "human_resolved" | "escalated" | "no_document" | "no_follow_up" | "detractor";
  startedMinsAgo?: number;
  startedDaysAgo?: number;
  durationSeconds?: number;
  handledBy?: string;
  sentimentStart?: number;
  sentimentEnd?: number;
  contained?: boolean;
  reviewScore?: number;
  reviewerName?: string;
  turns: Turn[];
  actions?: { action: string; label: string; amountPence?: number; allowed: boolean; at: number }[];
  handoff?: {
    reason: string;
    waitingMinsAgo: number;
    brief: Record<string, unknown>;
  };
};

const CONVERSATIONS: Seed[] = [
  /* ── Live: the call the whole design is built around ─────────────────── */
  {
    customerRef: "AH-CU-40912",
    channel: "phone",
    intent: "Third delivery reschedule → cancellation threat",
    // Waiting rather than live: this conversation exists for the brief it
    // produced, which belongs in the handoff queue. A seeded call left "live"
    // sits in the live console for ever and hides the one you just placed.
    status: "waiting_human",
    outcome: "escalated",
    startedMinsAgo: 5,
    sentimentStart: -0.1,
    sentimentEnd: -0.32,
    contained: false,
    turns: [
      { speaker: "customer", at: 221, body: "Hello — I'm calling about my sofa order, AH-40912." },
      {
        speaker: "ai",
        at: 224,
        body: "I have it in front of me, Marguerite. It's the Lindholm three-seater, currently scheduled for Friday the 5th. I can see it's been moved twice before that.",
        cite: "Service promise v4",
        check: "Identity verified by number",
      },
      {
        speaker: "customer",
        at: 242,
        body: "This is the third time the delivery slot has moved. I've taken a day off work for this.",
        sentiment: -0.28,
      },
      {
        speaker: "ai",
        at: 246,
        body: "You've had three reschedules, so this qualifies for the goodwill credit under your service promise. I can apply £40 now and book a fixed morning slot for Thursday — you won't be given a window this time.",
        cite: "Service promise v4",
        check: "Goodwill ceiling £50 · within policy",
      },
      { speaker: "customer", at: 249, body: "Fine. But this has cost me two days now." },
      {
        speaker: "customer",
        at: 251,
        body: "And I want the installation fee waived. Otherwise I'm cancelling the whole contract.",
        sentiment: -0.32,
      },
      {
        speaker: "ai",
        at: 252,
        body: "That's a decision for a manager, and I'd rather not guess at it. I'm getting one now — you'll keep the credit and the slot either way.",
        cite: "Fee schedule 2026",
        check: "Refused to exceed authority",
      },
    ],
    actions: [
      { action: "goodwill_credit", label: "£40 goodwill credit applied", amountPence: 4000, allowed: true, at: 246 },
      { action: "reschedule_delivery", label: "Thu AM slot provisionally held", allowed: true, at: 247 },
      { action: "waive_fee", label: "Waive £85 install fee", amountPence: 8500, allowed: false, at: 251 },
    ],
    handoff: {
      reason: "Install fee waiver beyond AI authority · cancellation intent",
      waitingMinsAgo: 6,
      brief: {
        wants:
          "The £85 installation fee waived on order AH-40912, on top of the £40 credit already applied, because the delivery has been rescheduled three times and she has taken two days off work.",
        alreadyDid: [
          { ok: true, text: "Applied £40 goodwill credit under Service promise v4 §3.2" },
          { ok: true, text: "Held a fixed Thursday 08:00–12:00 slot (not yet confirmed to her)" },
          { ok: true, text: "Verified identity by number and confirmed the delivery address" },
          { ok: false, text: "Did not discuss the fee — outside its authority, and it said so plainly" },
        ],
        decision: "Waive the £85 install fee?",
        decisionContext:
          "Your policy allows a Manager to waive fees after two or more service failures. This is the third. Retention model puts the account at £14,280 lifetime value against an £85 concession.",
        openingLine:
          "Marguerite, it's Dania — I'm the manager here and I've read everything, so you don't need to go through it again. Three moved deliveries isn't acceptable. Here's what I can do about the fee.",
        sensitivities:
          "Dislikes being transferred, has asked twice for a single owner. Do not offer another evening slot.",
      },
    },
  },

  /* ── The archive's worked example ─────────────────────────────────────── */
  {
    customerRef: "AH-CU-40914",
    channel: "whatsapp",
    intent: "Part-delivery refund request",
    status: "resolved",
    outcome: "human_resolved",
    startedDaysAgo: 6,
    durationSeconds: 862,
    handledBy: "A. Lindberg",
    sentimentStart: -0.41,
    sentimentEnd: 0.28,
    contained: false,
    reviewScore: 4,
    reviewerName: "D. Rahman",
    turns: [
      {
        speaker: "customer",
        body: "Two of the four chairs arrived. I don't want to wait a month for the rest — can I get a refund on the two that are missing?",
        sentiment: -0.41,
      },
      {
        speaker: "ai",
        body: "I can see the split shipment on order AH-38771. I don't have a policy covering a refund on part of an order, so I don't want to promise you something that gets reversed later.",
        check: "Searched 4 documents · no match ≥ 60%",
      },
      { speaker: "customer", body: "Then put me through to someone who can decide." },
      {
        speaker: "ai",
        body: "Doing that now. I've written down the order number, which chairs arrived, and what you're asking for, so you won't have to repeat it.",
        check: "Handoff brief generated",
      },
      {
        speaker: "human",
        author: "A. Lindberg",
        body: "I've read the whole thing, Sofia — you're owed a decision, not a wait. Approved £120 back on the two undelivered chairs and kept the rest of the order live.",
        sentiment: 0.28,
      },
    ],
    actions: [{ action: "partial_refund", label: "£120 partial refund approved", amountPence: 12000, allowed: true, at: 780 }],
  },

  /* ── The rest of the handoff queue ────────────────────────────────────── */
  {
    customerRef: "AH-CU-40913",
    channel: "phone",
    intent: "Invoice dispute £8,410",
    status: "waiting_human",
    outcome: "escalated",
    startedMinsAgo: 12,
    durationSeconds: 581,
    sentimentEnd: -0.18,
    contained: false,
    turns: [
      { speaker: "customer", body: "This invoice is wrong. We were quoted trade pricing at twenty-five units and billed at twelve percent." },
      {
        speaker: "ai",
        body: "I can see the discrepancy between the trade discount tiers and the 2026 fee schedule — they disagree, so I won't tell you which one applies. I'm getting someone from finance.",
        check: "Contradictory documents · escalated",
      },
    ],
    handoff: {
      reason: "Disputed invoice £8,410 · needs finance approval",
      waitingMinsAgo: 4,
      brief: {
        wants: "The invoice re-cut at the 18% trade tier they were quoted, a difference of £8,410.",
        alreadyDid: [
          { ok: true, text: "Confirmed the order is 27 units, above the 25-unit threshold" },
          { ok: false, text: "Did not state which discount applies — the two documents contradict each other" },
        ],
        decision: "Honour the 18% tier and issue a credit note for £8,410?",
        decisionContext:
          "Trade discount tiers says 18% above 25 units. Fee schedule 2026 says 12%. The conflict is unresolved and flagged on the Knowledge screen.",
        openingLine:
          "It's Joseph — I can see our own two documents disagree, which isn't your problem. Let me tell you what we'll honour.",
        sensitivities: "Renewal is in 21 days. £96,500 lifetime value.",
      },
    },
  },
  {
    customerRef: "AH-CU-40915",
    channel: "email",
    intent: "Trade pricing for 12 units",
    status: "waiting_human",
    outcome: "no_document",
    startedMinsAgo: 32,
    sentimentEnd: 0.04,
    contained: false,
    turns: [
      { speaker: "customer", body: "What would twelve units of the Lindholm range cost us on our trade account?" },
      {
        speaker: "ai",
        body: "I don't have a document that covers trade pricing at twelve units without contradicting the fee schedule, so I've asked a colleague rather than quote you a number that might change.",
        check: "No match ≥ 60%",
      },
    ],
    handoff: {
      reason: "Trade pricing question with no matching document",
      waitingMinsAgo: 9,
      brief: {
        wants: "A price for twelve units of the Lindholm range on their trade account.",
        alreadyDid: [{ ok: false, text: "Did not quote — the two pricing documents disagree at this volume" }],
        decision: "What discount applies at twelve units?",
        decisionContext: "Trade discount tiers starts at ten units (12%). Fee schedule 2026 does not list a twelve-unit band.",
        openingLine: "It's about your twelve-unit question — I've got the number for you.",
        sensitivities: "Expanding account, usage up 40%, no owner assigned.",
      },
    },
  },
  {
    customerRef: "AH-CU-40916",
    channel: "whatsapp",
    intent: "Written confirmation of a verbal promise",
    status: "waiting_human",
    outcome: "escalated",
    startedMinsAgo: 41,
    sentimentEnd: 0.12,
    contained: false,
    turns: [
      { speaker: "customer", body: "Someone promised me a free collection on the phone last week. I'd like that in writing." },
      {
        speaker: "ai",
        body: "I can see the call but not a recorded promise on the order, so I can't confirm it myself. I'm asking someone who can look properly.",
        check: "No record of the commitment",
      },
    ],
    handoff: {
      reason: "Wants written confirmation of a verbal promise",
      waitingMinsAgo: 11,
      brief: {
        wants: "Written confirmation of a free collection promised verbally on a previous call.",
        alreadyDid: [{ ok: false, text: "Could not confirm — the promise was never recorded against the order" }],
        decision: "Honour the unrecorded promise?",
        decisionContext: "Same root cause as the Okonkwo case: verbal commitments are not being written to the order.",
        openingLine: "I've found your call from last week — let me sort this out.",
        sensitivities: "NPS detractor since June.",
      },
    },
  },
  {
    customerRef: "AH-CU-40917",
    channel: "phone",
    intent: "Card declined twice",
    status: "waiting_human",
    outcome: "escalated",
    startedMinsAgo: 55,
    sentimentEnd: 0.05,
    contained: false,
    turns: [
      { speaker: "customer", body: "My card has been declined twice and I'd like to speak to accounts." },
      {
        speaker: "ai",
        body: "I can send a secure payment link now, but I can't discuss the account balance itself. Putting you through to accounts.",
        check: "Asked for a human · escalated",
      },
    ],
    actions: [{ action: "send_payment_link", label: "Secure payment link sent", allowed: true, at: 90 }],
    handoff: {
      reason: "Card declined twice · asked to speak to accounts",
      waitingMinsAgo: 14,
      brief: {
        wants: "To resolve two failed payments and speak to someone about the account.",
        alreadyDid: [{ ok: true, text: "Sent a secure payment link" }],
        decision: "Extend payment terms, or take payment on the link?",
        decisionContext: "Card on file expires this month. £1,260 lifetime value, Tier 3.",
        openingLine: "It's accounts — I can see the two declines, let's get this sorted.",
        sensitivities: "Low value; do not spend a long call here.",
      },
    },
  },
  {
    customerRef: "AH-CU-40923",
    channel: "email",
    intent: "Complaint about a previous agent",
    status: "waiting_human",
    outcome: "escalated",
    startedMinsAgo: 90,
    sentimentEnd: -0.2,
    contained: false,
    turns: [
      { speaker: "customer", body: "I want to complain about how I was spoken to on my last call." },
      {
        speaker: "ai",
        body: "That should be heard by a person, not by me. I've passed it straight on with what you've written.",
        check: "Policy: human only",
      },
    ],
    handoff: {
      reason: "Complaint about a previous agent — policy requires a human",
      waitingMinsAgo: 22,
      brief: {
        wants: "To complain about the conduct of an agent on a previous call.",
        alreadyDid: [{ ok: false, text: "Did not attempt to resolve — policy routes complaints to a human unread" }],
        decision: "Who owns the complaint, and does it need a formal response?",
        decisionContext: "Policy: human only. The AI did not read or summarise the complaint beyond routing it.",
        openingLine: "I'm sorry — I've read what you sent and I'd like to hear it properly.",
        sensitivities: "Do not have the AI respond to this thread again.",
      },
    },
  },

  /* ── Resolved history, for the archive and the 360 timeline ───────────── */
  {
    customerRef: "AH-CU-40916",
    channel: "phone",
    intent: "Warranty claim, sofa frame",
    status: "resolved",
    outcome: "ai_resolved",
    startedDaysAgo: 1,
    durationSeconds: 372,
    sentimentEnd: 0.36,
    contained: true,
    turns: [
      { speaker: "customer", body: "One of the sofa legs has split at the joint." },
      {
        speaker: "ai",
        body: "Frames carry a ten-year structural warranty, and a frame claim doesn't need a visit — just photographs and your order reference. I've opened the claim.",
        cite: "Warranty terms",
        check: "Within warranty · no visit required",
      },
    ],
  },
  {
    customerRef: "AH-CU-40920",
    channel: "web_chat",
    intent: "Change delivery address",
    status: "resolved",
    outcome: "ai_resolved",
    startedDaysAgo: 2,
    durationSeconds: 128,
    sentimentEnd: 0.62,
    contained: true,
    turns: [
      { speaker: "customer", body: "Can I change the delivery address on my order?" },
      {
        speaker: "ai",
        body: "Done — rebooked to the new address. You can change it again free of charge up to 48 hours before the booked day.",
        cite: "Delivery ops playbook",
        check: "Within the free-change window",
      },
    ],
  },
  {
    customerRef: "AH-CU-40921",
    channel: "phone",
    intent: "Bulk order lead time",
    status: "resolved",
    outcome: "ai_resolved",
    startedDaysAgo: 3,
    durationSeconds: 295,
    sentimentEnd: 0.71,
    contained: true,
    turns: [
      { speaker: "customer", body: "What's the lead time on a bulk order at the moment?" },
      {
        speaker: "ai",
        body: "The courier feed shows capacity from the following week. I won't give you a specific date until it's confirmed there.",
        cite: "Delivery ops playbook",
        check: "Refused to state an unconfirmed date",
      },
    ],
  },
  {
    customerRef: "AH-CU-40917",
    channel: "whatsapp",
    intent: "Failed payment, card expired",
    status: "resolved",
    outcome: "ai_resolved",
    startedDaysAgo: 4,
    durationSeconds: 104,
    sentimentEnd: 0.15,
    contained: true,
    turns: [
      { speaker: "customer", body: "My payment failed — I think my card expired." },
      {
        speaker: "ai",
        body: "That's what I can see too. I've sent you a secure link to update it; I can't take card details over a message.",
        check: "Never takes card details by voice or text",
      },
    ],
    actions: [{ action: "send_payment_link", label: "Secure payment link sent", allowed: true, at: 40 }],
  },
  {
    customerRef: "AH-CU-40912",
    channel: "whatsapp",
    intent: "Where is my order?",
    status: "resolved",
    outcome: "ai_resolved",
    startedDaysAgo: 7,
    durationSeconds: 126,
    sentimentEnd: 0.11,
    contained: true,
    turns: [
      { speaker: "customer", body: "Where has my order got to?" },
      {
        speaker: "ai",
        body: "It's with the courier for the 2nd. I've rebooked to that slot at your request.",
        cite: "Delivery ops playbook",
        check: "Reschedule within policy",
      },
    ],
  },
  {
    customerRef: "AH-CU-40912",
    channel: "phone",
    intent: "Second reschedule complaint",
    status: "resolved",
    outcome: "human_resolved",
    startedDaysAgo: 21,
    durationSeconds: 698,
    handledBy: "R. Mehta",
    sentimentEnd: -0.08,
    contained: false,
    turns: [
      { speaker: "customer", body: "That's twice now the delivery has moved." },
      {
        speaker: "human",
        author: "R. Mehta",
        body: "Apologised and issued a £25 credit, promised a fixed slot next time.",
      },
    ],
    actions: [{ action: "goodwill_credit", label: "£25 goodwill credit applied", amountPence: 2500, allowed: true, at: 400 }],
  },
  {
    customerRef: "AH-CU-40912",
    channel: "survey",
    intent: "NPS response",
    status: "resolved",
    outcome: "detractor",
    startedDaysAgo: 76,
    sentimentEnd: -0.2,
    contained: true,
    turns: [
      { speaker: "customer", body: "Scored 4. Delivery reliability is the problem — the product itself is lovely." },
    ],
  },
];

/* ─── Background traffic ───────────────────────────────────────────────── */

/**
 * The conversations nobody writes by hand.
 *
 * The fourteen above are the ones the screens tell stories about; these are
 * the sixty days of ordinary contacts underneath them. Without volume the
 * containment chart is a single column, the channel mix is three bars, the
 * weekly trend has one point, and the command centre reports that the AI
 * finished nothing today — all of which misrepresent a working deployment.
 *
 * Generated from a fixed seed so the charts do not move between runs.
 */
const ROUTINE: { intent: string; channel: Seed["channel"]; contained: boolean; ask: string; reply: string; cite?: string }[] = [
  { intent: "Where is my order?", channel: "whatsapp", contained: true, ask: "Any update on my delivery?", reply: "It's booked for Thursday with a four-hour window, confirmed the evening before. Nothing has moved.", cite: "Delivery ops playbook" },
  { intent: "Change delivery address", channel: "web_chat", contained: true, ask: "Can I change the delivery address?", reply: "Done — it's now going to the new address. The day and window are unchanged.", cite: "Delivery ops playbook" },
  { intent: "Fabric care", channel: "web_chat", contained: true, ask: "How do I clean the fabric?", reply: "Damp cloth and mild soap, never a solvent cleaner. Rotate the cushions monthly for the first year.", cite: "Care guide · Lindholm" },
  { intent: "Installation fee", channel: "phone", contained: true, ask: "What does installation cost?", reply: "£85 for a single room, £140 multi-room. That covers assembly, levelling and taking the packaging away.", cite: "Fee schedule 2026" },
  { intent: "Warranty length", channel: "email", contained: true, ask: "How long is the warranty?", reply: "Ten years on the frame, two on upholstery and foam. A frame claim needs photographs and the order reference — no visit.", cite: "Warranty terms" },
  { intent: "Reschedule a delivery", channel: "whatsapp", contained: true, ask: "I need to move my delivery day.", reply: "Moved. There's no charge — you're more than 48 hours out.", cite: "Delivery ops playbook" },
  { intent: "Failed payment", channel: "sms", contained: true, ask: "My card was declined.", reply: "I've sent you a secure link to update the card. I can't take the number over the phone.", cite: "Fee schedule 2026" },
  { intent: "Order status after dispatch", channel: "phone", contained: true, ask: "Has my order left the warehouse?", reply: "It has — it's with the courier and still on for the booked day.", cite: "Delivery ops playbook" },
  { intent: "Goodwill after a missed slot", channel: "phone", contained: true, ask: "You missed the window again.", reply: "I've applied a £50 credit to the original card — five working days. Your warranty start date is unaffected.", cite: "Service promise v4" },
  { intent: "Trade discount question", channel: "email", contained: false, ask: "What discount do I get at thirty units?", reply: "I'd rather not guess at that — two of our documents disagree. Getting someone who can confirm it." },
  { intent: "Part-delivery refund", channel: "whatsapp", contained: false, ask: "Half of it arrived. What happens to the rest of the money?", reply: "I don't have a policy covering part-delivery refunds, so I'm not going to invent one. Bringing in a colleague." },
  { intent: "Assembly service area", channel: "web_chat", contained: false, ask: "Do you assemble in Inverness?", reply: "I can't see a service area document for assembly, so I won't promise either way. Getting someone." },
  { intent: "Waive the delivery fee", channel: "phone", contained: false, ask: "Can you waive the delivery fee for the trouble?", reply: "That's a manager's decision and not mine to make. I'm getting one now." },
  { intent: "Cancel an order", channel: "phone", contained: false, ask: "I want to cancel the whole thing.", reply: "I want to get this right rather than guess, so I'm bringing in a colleague now." },
];

function generateTraffic(days = 60) {
  // Deterministic: the same charts every run.
  let state = 0x51f3a7;
  const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);

  const out: {
    template: (typeof ROUTINE)[number];
    startedAt: Date;
    durationSeconds: number;
    sentimentEnd: number;
    reviewScore: number | null;
  }[] = [];

  for (let d = days; d >= 0; d--) {
    const date = new Date(Date.now() - d * 864e5);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const count = Math.round((weekend ? 3 : 9) * (0.7 + next() * 0.7));

    for (let i = 0; i < count; i++) {
      // Contacts cluster around late morning and mid-afternoon, the way a
      // helpline's day actually looks.
      const hour = next() < 0.55 ? 9 + Math.floor(next() * 4) : 13 + Math.floor(next() * 6);
      const startedAt = new Date(date);
      startedAt.setHours(hour, Math.floor(next() * 60), 0, 0);
      // Today's traffic must not be in the future.
      if (startedAt.getTime() > Date.now()) startedAt.setTime(Date.now() - Math.floor(next() * 36e5));

      // Roughly three in four contacts are ones the AI finishes.
      const wantContained = next() < 0.76;
      const pool = ROUTINE.filter((r) => r.contained === wantContained);
      const template = pool[Math.floor(next() * pool.length)];

      out.push({
        template,
        startedAt,
        durationSeconds: Math.round((template.contained ? 90 : 240) + next() * 260),
        sentimentEnd: template.contained ? 0.2 + next() * 0.6 : -0.5 + next() * 0.5,
        // A fifth of finished conversations get reviewed by a person.
        reviewScore: next() < 0.2 ? (template.contained ? 4 + Math.round(next()) : 2 + Math.round(next() * 2)) : null,
      });
    }
  }
  return out;
}

async function main() {
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, "aurelius-home")).limit(1);
  if (!brand) throw new Error("Seed the workspace first: npm run db:seed");

  const [liveVersion] = await db
    .select()
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, brand.id), eq(s.agentVersions.status, "live")))
    .limit(1);

  const customers = await db.select().from(s.customers).where(eq(s.customers.brandId, brand.id));
  const byRef = new Map(customers.map((c) => [c.externalRef!, c]));

  const documents = await db.select().from(s.documents).where(eq(s.documents.brandId, brand.id));
  const docByTitle = new Map(documents.map((d) => [d.title, d]));

  // Re-runnable: clear the conversation graph, leave customers and documents.
  const existing = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brand.id));
  for (const c of existing) {
    await db.delete(s.conversations).where(eq(s.conversations.id, c.id));
  }

  let turnCount = 0;
  let handoffCount = 0;

  for (const seed of CONVERSATIONS) {
    const customer = byRef.get(seed.customerRef);
    if (!customer) continue;

    const startedAt =
      seed.startedDaysAgo !== undefined ? daysAgo(seed.startedDaysAgo) : minsAgo(seed.startedMinsAgo ?? 0);

    const [conversation] = await db
      .insert(s.conversations)
      .values({
        brandId: brand.id,
        customerId: customer.id,
        channel: seed.channel,
        intent: seed.intent,
        status: seed.status,
        outcome: seed.outcome ?? null,
        agentVersionId: liveVersion?.id ?? null,
        handledBy: seed.handledBy ?? null,
        sentimentStart: seed.sentimentStart ?? null,
        sentimentEnd: seed.sentimentEnd ?? null,
        startedAt,
        endedAt: seed.status === "resolved" ? new Date(startedAt.getTime() + (seed.durationSeconds ?? 0) * 1000) : null,
        durationSeconds: seed.durationSeconds ?? null,
        contained: seed.contained ?? null,
        reviewScore: seed.reviewScore ?? null,
        reviewerName: seed.reviewerName ?? null,
      })
      .returning();

    for (const [i, turn] of seed.turns.entries()) {
      const [row] = await db
        .insert(s.turns)
        .values({
          conversationId: conversation.id,
          ordinal: i,
          speaker: turn.speaker,
          authorName: turn.author ?? null,
          body: turn.body,
          sentiment: turn.sentiment ?? null,
          atSeconds: turn.at ?? null,
        })
        .returning();
      turnCount++;

      if (turn.cite || turn.check) {
        const doc = turn.cite ? docByTitle.get(turn.cite) : undefined;
        await db.insert(s.turnCitations).values({
          turnId: row.id,
          documentId: doc?.id ?? null,
          confidence: doc ? 0.92 : null,
          checkLabel: turn.check ?? null,
        });
      }
    }

    for (const action of seed.actions ?? []) {
      await db.insert(s.conversationActions).values({
        conversationId: conversation.id,
        action: action.action,
        label: action.label,
        amountPence: action.amountPence ?? null,
        atSeconds: action.at,
        allowed: action.allowed,
      });
    }

    if (seed.handoff) {
      await db.insert(s.handoffs).values({
        conversationId: conversation.id,
        brandId: brand.id,
        reason: seed.handoff.reason,
        brief: seed.handoff.brief,
        status: "waiting",
        waitingSince: minsAgo(seed.handoff.waitingMinsAgo),
      });
      handoffCount++;
    }
  }

  // Background traffic. Inserted in bulk rather than row by row — 500
  // conversations of round trips takes minutes over a pooled connection.
  const traffic = generateTraffic();
  const reviewers = ["D. Rahman", "J. Okafor", "A. Lindberg"];
  const trafficRows = await db
    .insert(s.conversations)
    .values(
      traffic.map((t, i) => ({
        brandId: brand.id,
        // Spread across the brand's customers so per-customer history is real.
        customerId: customers[i % customers.length].id,
        channel: t.template.channel,
        intent: t.template.intent,
        status: "resolved" as const,
        outcome: t.template.contained ? ("ai_resolved" as const) : ("escalated" as const),
        agentVersionId: liveVersion?.id ?? null,
        handledBy: t.template.contained ? null : reviewers[i % reviewers.length],
        sentimentStart: 0,
        sentimentEnd: t.sentimentEnd,
        startedAt: t.startedAt,
        endedAt: new Date(t.startedAt.getTime() + t.durationSeconds * 1000),
        durationSeconds: t.durationSeconds,
        contained: t.template.contained,
        reviewScore: t.reviewScore,
        reviewerName: t.reviewScore ? reviewers[i % reviewers.length] : null,
        reviewedAt: t.reviewScore ? new Date(t.startedAt.getTime() + 864e5) : null,
      })),
    )
    .returning({ id: s.conversations.id });

  const trafficTurns = trafficRows.flatMap((row, i) => [
    { conversationId: row.id, ordinal: 0, speaker: "customer" as const, body: traffic[i].template.ask, atSeconds: 0 },
    { conversationId: row.id, ordinal: 1, speaker: "ai" as const, body: traffic[i].template.reply, atSeconds: 12 },
  ]);
  const insertedTurns: { id: string; conversationId: string; ordinal: number }[] = [];
  for (let i = 0; i < trafficTurns.length; i += 1000) {
    const batch = await db
      .insert(s.turns)
      .values(trafficTurns.slice(i, i + 1000))
      .returning({ id: s.turns.id, conversationId: s.turns.conversationId, ordinal: s.turns.ordinal });
    insertedTurns.push(...batch);
  }
  turnCount += insertedTurns.length;

  // Cite the document each reply actually leaned on. A grounded answer with
  // no citation row would make the quality screens count a failure that did
  // not happen.
  const trafficCitations = insertedTurns
    .filter((t) => t.ordinal === 1)
    .map((t) => {
      const index = trafficRows.findIndex((r) => r.id === t.conversationId);
      const cite = index >= 0 ? traffic[index].template.cite : undefined;
      const doc = cite ? docByTitle.get(cite) : undefined;
      return doc ? { turnId: t.id, documentId: doc.id, confidence: 0.88 } : null;
    })
    .filter((x): x is { turnId: string; documentId: string; confidence: number } => x !== null);
  for (let i = 0; i < trafficCitations.length; i += 1000) {
    await db.insert(s.turnCitations).values(trafficCitations.slice(i, i + 1000));
  }

  console.log(`\nSeeded ${CONVERSATIONS.length} written conversations and ${trafficRows.length} of background traffic.`);
  console.log(`  ${turnCount} turns, ${trafficCitations.length} citations, ${handoffCount} handoffs.`);
  console.log("Run `npm run db:rescore` so the rules see the new history.\n");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
