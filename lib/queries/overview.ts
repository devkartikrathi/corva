import { and, eq, gte, isNotNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { attendanceBetween, shiftDay, todayInIndia } from "@/lib/people/attendance";

/**
 * The business at a glance: its customers, and the people serving them.
 *
 * Two questions, kept side by side because an owner asks them together — how
 * many customers reached us and who answered (the AI, or one of us), and who
 * was at work and what each of them carried. Orders and jobs are not here:
 * those live in the business's own system.
 *
 * Everything is counted from records that exist for other reasons
 * (conversations, handoffs, follow-ups, leads, attendance), so no number on
 * the screen can disagree with the screen it links to.
 */

const CHANNEL_LABELS: Record<string, string> = { phone: "Phone calls", web_chat: "Website chat", whatsapp: "WhatsApp", email: "Email", sms: "SMS", survey: "Surveys" };
export const channelLabel = (channel: string) => CHANNEL_LABELS[channel] ?? channel;

const istDay = (column: AnyColumn) => sql<string>`to_char(${column} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

export type PersonRow = {
  id: string;
  name: string;
  role: string;
  availability: "available" | "busy" | "offline";
  calls: number;
  chats: number;
  handoffs: number;
  followUpsDone: number;
  leadsWon: number;
  minutes: number;
  daysPresent: number;
  atWork: boolean;
};

export async function businessOverview(orgId: string, brandId: string, days: number, onlyMembershipId?: string) {
  const today = todayInIndia();
  const firstDay = shiftDay(today, -(days - 1));
  // Midnight in India on the first day.
  const from = new Date(`${firstDay}T00:00:00+05:30`);
  const real = and(eq(s.conversations.brandId, brandId), eq(s.conversations.isTest, false), gte(s.conversations.startedAt, from));

  const [members, customerTotals, byChannel, daily, taken, handoffs, followUps, won] = await Promise.all([
    db
      .select({ id: s.memberships.id, name: s.memberships.name, role: s.memberships.role, availability: s.memberships.availability })
      .from(s.memberships)
      .where(and(eq(s.memberships.orgId, orgId), eq(s.memberships.status, "active"))),

    db
      .select({
        total: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${s.customers.createdAt} >= ${from})::int`,
      })
      .from(s.customers)
      .where(eq(s.customers.brandId, brandId)),

    // Who answered, by the way the customer reached us.
    db
      .select({
        channel: s.conversations.channel,
        ai: sql<number>`count(*) filter (where ${s.conversations.handledBy} is null)::int`,
        people: sql<number>`count(*) filter (where ${s.conversations.handledBy} is not null)::int`,
        customers: sql<number>`count(distinct ${s.conversations.customerId})::int`,
      })
      .from(s.conversations)
      .where(real)
      .groupBy(s.conversations.channel),

    db
      .select({
        day: istDay(s.conversations.startedAt),
        ai: sql<number>`count(*) filter (where ${s.conversations.handledBy} is null)::int`,
        people: sql<number>`count(*) filter (where ${s.conversations.handledBy} is not null)::int`,
      })
      .from(s.conversations)
      .where(real)
      .groupBy(istDay(s.conversations.startedAt)),

    // `handled_by` is the person's name, not an id: it is what the transcript shows.
    db
      .select({
        name: s.conversations.handledBy,
        calls: sql<number>`count(*) filter (where ${s.conversations.channel} = 'phone')::int`,
        chats: sql<number>`count(*) filter (where ${s.conversations.channel} <> 'phone')::int`,
      })
      .from(s.conversations)
      .where(and(real, isNotNull(s.conversations.handledBy)))
      .groupBy(s.conversations.handledBy),

    db
      .select({ id: s.handoffs.acceptedByMembershipId, n: sql<number>`count(*)::int` })
      .from(s.handoffs)
      .where(and(eq(s.handoffs.brandId, brandId), isNotNull(s.handoffs.acceptedByMembershipId), gte(s.handoffs.acceptedAt, from)))
      .groupBy(s.handoffs.acceptedByMembershipId),

    db
      .select({ name: s.followUps.completedByName, n: sql<number>`count(*)::int` })
      .from(s.followUps)
      .where(and(eq(s.followUps.brandId, brandId), eq(s.followUps.status, "done"), gte(s.followUps.completedAt, from)))
      .groupBy(s.followUps.completedByName),

    db
      .select({ id: s.leads.ownerMembershipId, n: sql<number>`count(*)::int` })
      .from(s.leads)
      .where(and(eq(s.leads.brandId, brandId), eq(s.leads.stage, "won"), gte(s.leads.stageChangedAt, from)))
      .groupBy(s.leads.ownerMembershipId),
  ]);

  const shown = onlyMembershipId ? members.filter((m) => m.id === onlyMembershipId) : members;
  const attended = await attendanceBetween(orgId, firstDay, today, shown.map((m) => m.id));

  const byName = <T extends { name: string | null }>(rows: T[]) => new Map(rows.filter((r) => r.name).map((r) => [r.name!, r]));
  const byId = (rows: { id: string | null; n: number }[]) => new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.n]));
  const takenBy = byName(taken);
  const doneBy = byName(followUps);
  const handoffsBy = byId(handoffs);
  const wonBy = byId(won);

  const people: PersonRow[] = shown
    .map((m) => {
      const daysOf = [...(attended.get(m.id)?.values() ?? [])];
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        availability: m.availability,
        calls: takenBy.get(m.name)?.calls ?? 0,
        chats: takenBy.get(m.name)?.chats ?? 0,
        handoffs: handoffsBy.get(m.id) ?? 0,
        followUpsDone: doneBy.get(m.name)?.n ?? 0,
        leadsWon: wonBy.get(m.id) ?? 0,
        minutes: daysOf.reduce((sum, d) => sum + d.minutes, 0),
        daysPresent: daysOf.filter((d) => d.status === "present" || d.status === "half_day").length,
        atWork: daysOf.some((d) => d.open),
      };
    })
    .sort((a, b) => b.calls + b.chats + b.followUpsDone - (a.calls + a.chats + a.followUpsDone) || a.name.localeCompare(b.name));

  const dayMap = new Map(daily.map((d) => [d.day, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const day = shiftDay(firstDay, i);
    return { day, ai: dayMap.get(day)?.ai ?? 0, people: dayMap.get(day)?.people ?? 0 };
  });

  const channels = byChannel
    .map((c) => ({ channel: c.channel as string, label: channelLabel(c.channel), ai: c.ai, people: c.people, total: c.ai + c.people, customers: c.customers }))
    .sort((a, b) => b.total - a.total);
  const ai = channels.reduce((n, c) => n + c.ai, 0);
  const byPeople = channels.reduce((n, c) => n + c.people, 0);

  return {
    from: firstDay,
    to: today,
    customers: { total: customerTotals[0]?.total ?? 0, fresh: customerTotals[0]?.fresh ?? 0 },
    conversations: { total: ai + byPeople, ai, people: byPeople },
    channels,
    series,
    people,
    atWorkNow: people.filter((p) => p.atWork).length,
  };
}
