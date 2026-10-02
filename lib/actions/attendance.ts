"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { clockIn, clockOut, markDay, type Status } from "@/lib/people/attendance";
import { audit } from "./audit";

/**
 * Attendance.
 *
 * Anyone records their own day. Recording someone else's is a manager's act,
 * and is written to the audit log with who did it — a day marked absent is a
 * thing a person may want to see the origin of.
 */

function refresh() {
  revalidatePath("/app/attendance");
  revalidatePath("/app/overview");
  revalidatePath("/app");
}

/** Start my day. Also puts me in the queue, if I was out of it. */
export async function startMyDay() {
  const { session } = await getConsoleContext();
  await clockIn(session.orgId, session.membershipId);
  if (session.availability === "offline" && can(session.actor, "calls.handle").allowed) {
    await db.update(s.memberships).set({ availability: "available", lastActiveAt: new Date() }).where(eq(s.memberships.id, session.membershipId));
  }
  refresh();
}

/** End my day, and take me out of the queue. */
export async function endMyDay() {
  const { session } = await getConsoleContext();
  await clockOut(session.membershipId);
  await db.update(s.memberships).set({ availability: "offline" }).where(eq(s.memberships.id, session.membershipId));
  refresh();
}

/** Whether this person may record other people's days. */
const managesPeople = (grant: string) => grant === "full" || grant === "own_team";

export async function markAttendance(membershipId: string, day: string, status: Status) {
  const { session } = await getConsoleContext();
  if (!managesPeople(can(session.actor, "people.manage").grant)) throw new Error("Your role cannot record someone else's attendance.");
  await markDay(session.orgId, membershipId, day, status, session.name);
  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "attendance.marked",
    target: membershipId,
    meta: { day, status },
  });
  refresh();
}
