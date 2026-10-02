import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Attendance: who was at work, on which day, for how long.
 *
 * A day is recorded two ways. The person clocks in and out themselves, which
 * gives hours; or a manager marks the day (present, half day, leave, absent),
 * which is how a day gets recorded for someone who never opens the console.
 * A manager's mark never erases the times someone clocked.
 */

export const STATUSES = ["present", "half_day", "leave", "absent"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { present: "Present", half_day: "Half day", leave: "On leave", absent: "Absent" };

type Row = typeof s.attendance.$inferSelect;
export type Day = { day: string; status: Status; clockIn: string | null; clockOut: string | null; minutes: number; open: boolean; markedBy: string | null; note: string | null };

/** Today's date in India, as YYYY-MM-DD. */
export const todayInIndia = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** A shift left open is counted to here and no further: nobody works a 30-hour day. */
const LONGEST_SHIFT_MINUTES = 14 * 60;

/** The seven days of the week containing `day`, Monday first. */
export function weekOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

export const shiftDay = (day: string, by: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);

const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : null);

function minutesWorked(r: Row, now: Date) {
  if (!r.clockInAt) return 0;
  // Still clocked in: count to now if it is today, otherwise the day was never closed.
  const end = r.clockOutAt ?? (r.day === todayInIndia(now) ? now : null);
  if (!end) return 0;
  return Math.max(0, Math.min(LONGEST_SHIFT_MINUTES, Math.round((end.getTime() - r.clockInAt.getTime()) / 60_000)));
}

const dayOf = (r: Row, now: Date): Day => ({
  day: r.day,
  status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as Status) : "present",
  clockIn: time(r.clockInAt),
  clockOut: time(r.clockOutAt),
  minutes: minutesWorked(r, now),
  open: Boolean(r.clockInAt && !r.clockOutAt && r.day === todayInIndia(now)),
  markedBy: r.markedByName,
  note: r.note,
});

/** Where this person's day stands right now. */
export async function myToday(membershipId: string): Promise<Day | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(s.attendance)
    .where(and(eq(s.attendance.membershipId, membershipId), eq(s.attendance.day, todayInIndia(now))))
    .limit(1);
  return row ? dayOf(row, now) : null;
}

/** Start the day. Clocking in twice keeps the first time. */
export async function clockIn(orgId: string, membershipId: string) {
  const now = new Date();
  const day = todayInIndia(now);
  const [existing] = await db.select().from(s.attendance).where(and(eq(s.attendance.membershipId, membershipId), eq(s.attendance.day, day))).limit(1);
  if (existing?.clockInAt && !existing.clockOutAt) return;
  if (existing) {
    // Back after clocking out, or a day a manager had marked: the day is open again.
    await db
      .update(s.attendance)
      .set({ status: "present", clockInAt: existing.clockInAt ?? now, clockOutAt: null, updatedAt: now })
      .where(eq(s.attendance.id, existing.id));
    return;
  }
  await db.insert(s.attendance).values({ orgId, membershipId, day, status: "present", clockInAt: now }).onConflictDoNothing();
}

/** End the day. */
export async function clockOut(membershipId: string) {
  const now = new Date();
  await db
    .update(s.attendance)
    .set({ clockOutAt: now, updatedAt: now })
    .where(and(eq(s.attendance.membershipId, membershipId), eq(s.attendance.day, todayInIndia(now))));
}

/** A manager records someone's day. Times the person clocked are kept. */
export async function markDay(orgId: string, membershipId: string, day: string, status: Status, by: string, note?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("That is not a date.");
  if (day > todayInIndia()) throw new Error("A day that has not happened yet cannot be marked.");
  if (!STATUSES.includes(status)) throw new Error("Unknown status.");
  const [member] = await db.select({ id: s.memberships.id }).from(s.memberships).where(and(eq(s.memberships.id, membershipId), eq(s.memberships.orgId, orgId))).limit(1);
  if (!member) throw new Error("No such person in this workspace.");
  const set = { status, markedByName: by, note: note?.trim().slice(0, 200) || null, updatedAt: new Date() };
  await db
    .insert(s.attendance)
    .values({ orgId, membershipId, day, ...set })
    .onConflictDoUpdate({ target: [s.attendance.membershipId, s.attendance.day], set });
}

/** Each person's days between two dates, by membership id then day. */
export async function attendanceBetween(orgId: string, from: string, to: string, membershipIds?: string[]) {
  const now = new Date();
  if (membershipIds && membershipIds.length === 0) return new Map<string, Map<string, Day>>();
  const rows = await db
    .select()
    .from(s.attendance)
    .where(
      and(
        eq(s.attendance.orgId, orgId),
        gte(s.attendance.day, from),
        lte(s.attendance.day, to),
        membershipIds ? inArray(s.attendance.membershipId, membershipIds) : undefined,
      ),
    );
  const out = new Map<string, Map<string, Day>>();
  for (const r of rows) {
    if (!out.has(r.membershipId)) out.set(r.membershipId, new Map());
    out.get(r.membershipId)!.set(r.day, dayOf(r, now));
  }
  return out;
}

/** 7h 30m — or 45m, or nothing at all for zero. */
export function hours(minutes: number) {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}
