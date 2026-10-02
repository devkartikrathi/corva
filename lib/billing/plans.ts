/**
 * The plans, in one place.
 *
 * The public pricing section, the billing page, what Razorpay is asked to
 * collect and what the product enforces all read this file — so the price a
 * business sees, the price it is charged and the limits it runs into cannot
 * disagree. docs/PRICING.md explains the reasoning and the unit costs.
 *
 * Amounts are whole rupees, before GST.
 */

export type Tier = "pilot" | "starter" | "growth" | "business";

export type Plan = {
  id: Tier;
  name: string;
  /** Rupees a month, before GST. Null: not sold through checkout. */
  priceRupees: number | null;
  /** AI chat conversations included in a period. */
  chats: number;
  /** AI voice minutes included in a period. */
  voiceMinutes: number;
  /**
   * What going over costs, in rupees. Null means there is no going over: the
   * assistant stops taking new conversations when the allowance is used.
   */
  overage: { chat: number; voiceMinute: number } | null;
  brands: number;
  members: number;
  /** How far back conversations stay readable, in days. */
  historyDays: number;
  /** Team performance and the audit log. */
  management: boolean;
  /** Days a period lasts. */
  periodDays: number;
};

const UNLIMITED = Number.POSITIVE_INFINITY;

export const PLANS: Record<Tier, Plan> = {
  pilot: {
    id: "pilot",
    name: "Pilot",
    priceRupees: 0,
    chats: 100,
    voiceMinutes: 30,
    overage: null,
    brands: 1,
    members: 5,
    historyDays: 90,
    // A pilot shows the whole product, so the owner can judge what they need.
    management: true,
    periodDays: 14,
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceRupees: 2999,
    chats: 500,
    voiceMinutes: 150,
    overage: { chat: 5, voiceMinute: 6 },
    brands: 1,
    members: 3,
    historyDays: 90,
    management: false,
    periodDays: 30,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceRupees: 8999,
    chats: 2500,
    voiceMinutes: 800,
    overage: { chat: 4, voiceMinute: 5 },
    brands: 3,
    members: 15,
    historyDays: 730,
    management: true,
    periodDays: 30,
  },
  business: {
    id: "business",
    name: "Business",
    priceRupees: null,
    chats: UNLIMITED,
    voiceMinutes: UNLIMITED,
    overage: null,
    brands: UNLIMITED,
    members: UNLIMITED,
    historyDays: 3650,
    management: true,
    periodDays: 30,
  },
};

/** Plans a business can buy for itself. */
export const BUYABLE: Tier[] = ["starter", "growth"];

export const isTier = (v: unknown): v is Tier => typeof v === "string" && v in PLANS;
export const planFor = (tier: string | null | undefined): Plan => (isTier(tier) ? PLANS[tier] : PLANS.pilot);

/** GST on software services in India. */
export const GST_RATE = 0.18;

/** After a period ends the assistant keeps answering this long, so a late payment is not an outage. */
export const GRACE_DAYS = 3;

/** How many days before a period ends the console starts offering renewal. */
export const RENEW_WINDOW_DAYS = 7;

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** "500", or "Unlimited". */
export const amount = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-IN") : "Unlimited");
