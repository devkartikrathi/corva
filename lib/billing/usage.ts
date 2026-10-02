import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { GRACE_DAYS, GST_RATE, RENEW_WINDOW_DAYS, planFor, type Plan } from "./plans";

/**
 * What a business has used, and where that leaves it.
 *
 * Nothing is counted into a separate ledger: usage is read from the
 * conversations themselves, for the current period. A chat is one conversation
 * the assistant took part in; a voice minute is a minute a call was connected.
 * Test conversations (the owner trying their own assistant) are free.
 */

const DAY = 864e5;

export type AccountState = {
  orgId: string;
  plan: Plan;
  periodStart: Date;
  periodEnd: Date;
  /**
   * active    inside the period
   * grace     the period has ended; still answering for a few days
   * lapsed    past the grace days: the assistant has stopped
   */
  status: "active" | "grace" | "lapsed";
  daysLeft: number;
  /** Renewal is worth offering: close to the end, past it, or on the pilot. */
  renewable: boolean;
  usage: { chats: number; voiceMinutes: number };
  /** Used beyond what the plan includes, and what that costs before GST. */
  over: { chats: number; voiceMinutes: number; rupees: number };
  /** The pilot (or any plan without overage) has used all it includes. */
  exhausted: { chats: boolean; voice: boolean };
  counts: { brands: number; members: number };
};

/** Usage between two instants, across all of an organization's brands. */
export async function usageBetween(orgId: string, from: Date, to: Date = new Date()) {
  const [row] = await db
    .select({
      chats: sql<number>`count(*) filter (where ${s.conversations.channel} <> 'phone' and exists (
        select 1 from ${s.turns} t where t.conversation_id = ${s.conversations.id} and t.speaker = 'ai'
      ))::int`,
      voiceSeconds: sql<number>`coalesce(sum(
        case when ${s.conversations.channel} = 'phone'
          -- A call that never recorded its end is counted as five minutes at most.
          then coalesce(${s.conversations.durationSeconds}, least(300, extract(epoch from (coalesce(${s.conversations.endedAt}, now()) - ${s.conversations.startedAt}))))
          else 0 end
      ), 0)::float`,
    })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .where(
      and(
        eq(s.brands.orgId, orgId),
        eq(s.conversations.isTest, false),
        gte(s.conversations.startedAt, from),
        sql`${s.conversations.startedAt} <= ${to}`,
      ),
    );
  return { chats: row?.chats ?? 0, voiceMinutes: Math.ceil((row?.voiceSeconds ?? 0) / 60) };
}

export function overageFor(plan: Plan, usage: { chats: number; voiceMinutes: number }) {
  const chats = Math.max(0, usage.chats - plan.chats);
  const voiceMinutes = Math.max(0, usage.voiceMinutes - plan.voiceMinutes);
  const rupees = plan.overage ? chats * plan.overage.chat + voiceMinutes * plan.overage.voiceMinute : 0;
  return { chats: Number.isFinite(chats) ? chats : 0, voiceMinutes: Number.isFinite(voiceMinutes) ? voiceMinutes : 0, rupees };
}

export async function accountState(orgId: string): Promise<AccountState> {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId)).limit(1);
  if (!org) throw new Error("No such organization.");
  const plan = planFor(org.tier);
  const periodStart = org.periodStart;
  const periodEnd = org.periodEnd ?? new Date(periodStart.getTime() + plan.periodDays * DAY);
  const now = Date.now();

  const [usage, [counts]] = await Promise.all([
    usageBetween(orgId, periodStart),
    db
      .select({
        brands: sql<number>`(select count(*)::int from ${s.brands} b where b.org_id = ${orgId})`,
        members: sql<number>`(select count(*)::int from ${s.memberships} m where m.org_id = ${orgId} and m.status in ('active', 'invited'))`,
      })
      .from(sql`(select 1) as one`),
  ]);

  const status = now <= periodEnd.getTime() ? "active" : now <= periodEnd.getTime() + GRACE_DAYS * DAY ? "grace" : "lapsed";
  const daysLeft = Math.ceil((periodEnd.getTime() - now) / DAY);
  return {
    orgId,
    plan,
    periodStart,
    periodEnd,
    status,
    daysLeft,
    renewable: plan.id === "pilot" || daysLeft <= RENEW_WINDOW_DAYS,
    usage,
    over: overageFor(plan, usage),
    exhausted: {
      chats: !plan.overage && usage.chats >= plan.chats,
      voice: !plan.overage && usage.voiceMinutes >= plan.voiceMinutes,
    },
    counts: { brands: counts?.brands ?? 0, members: counts?.members ?? 0 },
  };
}

/** The same, for code that knows the brand. */
export async function accountStateForBrand(brandId: string) {
  const [brand] = await db.select({ orgId: s.brands.orgId }).from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
  if (!brand) throw new Error("No such business.");
  return accountState(brand.orgId);
}

/**
 * Why the assistant cannot take a new conversation right now, or null when it can.
 *
 * Checked when a conversation *starts* — never mid-conversation: a customer
 * half way through a booking is not cut off because the allowance ran out.
 */
export function blocked(state: AccountState, kind: "chat" | "voice"): string | null {
  if (state.status === "lapsed") {
    return state.plan.id === "pilot"
      ? "This business's Corva pilot has ended. Choose a plan in Corva → Billing to switch the assistant back on."
      : "This business's Corva plan has run out. Renew it in Corva → Billing to switch the assistant back on.";
  }
  if (kind === "chat" && state.exhausted.chats) {
    return `This business has used the ${state.plan.chats} chats in its ${state.plan.name.toLowerCase()}. Choose a plan in Corva → Billing to carry on.`;
  }
  if (kind === "voice" && state.exhausted.voice) {
    return `This business has used the ${state.plan.voiceMinutes} voice minutes in its ${state.plan.name.toLowerCase()}. Choose a plan in Corva → Billing to carry on.`;
  }
  return null;
}

/**
 * What the API says when a business's plan has no room for a new conversation.
 * Worded for whoever ends up reading it — often the business's customer, since
 * sites pass API errors straight to their chat window. The real reason is on
 * the business's Billing page and in the console's banner.
 */
export const UNAVAILABLE = "The assistant is not available right now. Please try again later.";

/** What buying or renewing a plan costs now: the plan, any overage owed, and GST. */
export function quote(target: Plan, state: AccountState) {
  if (target.priceRupees === null) return null;
  // Overage is owed for the period being closed, at that period's plan rates.
  const overageRupees = state.over.rupees;
  const net = target.priceRupees + overageRupees;
  const gstRupees = Math.round(net * GST_RATE * 100) / 100;
  return {
    planRupees: target.priceRupees,
    overageRupees,
    gstRupees,
    totalRupees: Math.round((net + gstRupees) * 100) / 100,
    totalPaise: Math.round((net + gstRupees) * 100),
  };
}
