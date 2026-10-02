import Link from "next/link";
import { ClockButton, MarkDay } from "@/components/Attendance";
import { Kicker, ScreenHeader } from "@/components/ui";
import { endMyDay, markAttendance, startMyDay } from "@/lib/actions/attendance";
import { getConsoleContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { accountState } from "@/lib/billing/usage";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { STATUS_LABELS, attendanceBetween, hours, myToday, shiftDay, todayInIndia, weekOf, type Status } from "@/lib/people/attendance";
import { and, asc, eq } from "drizzle-orm";

/**
 * Attendance: the week, a person a row.
 *
 * Everyone can open it, and what they see follows the shape of the business:
 * an owner or manager sees the whole team, anyone else sees their own row.
 * People start and end their own day; a manager can record a day for someone
 * who did not (leave, an absence, a day worked away from a screen).
 */

const TONE: Record<Status, { bg: string; fg: string }> = {
  present: { bg: "var(--color-accent)", fg: "var(--color-bg)" },
  half_day: { bg: "var(--color-neutral-400)", fg: "var(--color-text)" },
  leave: { bg: "var(--color-neutral-300)", fg: "var(--color-neutral-800)" },
  absent: { bg: "transparent", fg: "var(--color-accent-700)" },
};

const ROLE_ORDER = ["owner", "admin", "manager", "agent", "analyst"];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { session } = await getConsoleContext();
  const params = await searchParams;
  const today = todayInIndia();
  const anchor = params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) && params.week <= today ? params.week : today;
  const week = weekOf(anchor);

  // The pyramid: who may see the team's days, and who may record them.
  const seesTeam = can(session.actor, "team.performance").grant !== "none";
  const manageGrant = can(session.actor, "people.manage").grant;
  const marks = manageGrant === "full" || manageGrant === "own_team";
  const account = await accountState(session.orgId);
  const team = seesTeam && account.plan.management;

  const members = (
    await db
      .select({ id: s.memberships.id, name: s.memberships.name, role: s.memberships.role })
      .from(s.memberships)
      .where(and(eq(s.memberships.orgId, session.orgId), eq(s.memberships.status, "active")))
      .orderBy(asc(s.memberships.name))
  )
    .filter((m) => team || m.id === session.membershipId)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  const [days, mine] = await Promise.all([
    attendanceBetween(session.orgId, week[0], week[6], members.map((m) => m.id)),
    myToday(session.membershipId),
  ]);

  const presentOn = (day: string) => members.filter((m) => ["present", "half_day"].includes(days.get(m.id)?.get(day)?.status ?? "")).length;
  const label = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", ...opts });
  const nextWeek = shiftDay(week[0], 7);

  return (
    <section>
      <ScreenHeader
        kicker={team ? `${session.orgName} · ${members.length} ${members.length === 1 ? "person" : "people"}` : "Your days"}
        title="Attendance"
        lede={team ? "Who was at work, and for how long. People start and end their own day; you can record a day for anyone." : "Start your day when you begin and end it when you finish."}
      >
        <ClockButton open={Boolean(mine?.open)} since={mine?.clockIn ?? null} worked={hours(mine?.minutes ?? 0)} onStart={startMyDay} onEnd={endMyDay} />
      </ScreenHeader>

      <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--color-neutral-300)", fontSize: 12.5 }}>
        <Link href={`/app/attendance?week=${shiftDay(week[0], -7)}`} className="hov-invert" style={{ border: "1px solid var(--color-neutral-400)", padding: "5px 10px", fontWeight: 700 }}>
          ← Earlier
        </Link>
        <b>
          {label(week[0], { day: "numeric", month: "short" })} – {label(week[6], { day: "numeric", month: "short", year: "numeric" })}
        </b>
        {nextWeek <= today && (
          <Link href={`/app/attendance?week=${nextWeek}`} className="hov-invert" style={{ border: "1px solid var(--color-neutral-400)", padding: "5px 10px", fontWeight: 700 }}>
            Later →
          </Link>
        )}
        {seesTeam && !account.plan.management && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            The whole team&rsquo;s attendance comes with the Growth plan.{" "}
            <Link href="/app/billing" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
              See plans →
            </Link>
          </span>
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div className="m-scroll">
        <table className="cv-table-xl" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "12px 8px 8px 0", width: 200 }}>
                <Kicker>Person</Kicker>
              </th>
              {week.map((day) => (
                <th key={day} style={{ textAlign: "left", padding: "12px 6px 8px", background: day === today ? "var(--color-surface)" : undefined }}>
                  <Kicker color={day === today ? "var(--color-text)" : undefined}>{label(day, { weekday: "short" })}</Kicker>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{label(day, { day: "numeric", month: "short" })}</div>
                  {team && day <= today && (
                    <div style={{ fontSize: 10.5, fontWeight: 400, color: "var(--color-neutral-700)" }}>
                      {presentOn(day)} of {members.length} in
                    </div>
                  )}
                </th>
              ))}
              <th style={{ textAlign: "right", padding: "12px 0 8px 8px", width: 110 }}>
                <Kicker>This week</Kicker>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const mineRow = days.get(m.id);
              const all = week.map((d) => mineRow?.get(d));
              const total = all.reduce((sum, d) => sum + (d?.minutes ?? 0), 0);
              const present = all.filter((d) => d && (d.status === "present" || d.status === "half_day")).length;
              return (
                <tr key={m.id} style={{ borderTop: "1px solid var(--color-neutral-300)" }}>
                  <td style={{ padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                    <b>{m.name}</b>
                    {m.id === session.membershipId && <span style={{ color: "var(--color-neutral-700)" }}> · you</span>}
                    <div style={{ fontSize: 11, color: "var(--color-neutral-700)", textTransform: "capitalize" }}>{m.role}</div>
                  </td>
                  {week.map((day, i) => {
                    const d = all[i];
                    const future = day > today;
                    return (
                      <td key={day} style={{ padding: "10px 6px", verticalAlign: "top", background: day === today ? "var(--color-surface)" : undefined }}>
                        {future ? (
                          <span style={{ color: "var(--color-neutral-400)" }}>·</span>
                        ) : (
                          <div style={{ display: "grid", gap: 3 }}>
                            {d ? (
                              <>
                                <span
                                  style={{
                                    justifySelf: "start",
                                    fontSize: 10.5,
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    background: TONE[d.status].bg,
                                    color: TONE[d.status].fg,
                                    border: d.status === "absent" ? "1px solid var(--color-accent-700)" : undefined,
                                  }}
                                >
                                  {STATUS_LABELS[d.status]}
                                </span>
                                {d.clockIn && (
                                  <span style={{ fontSize: 11, color: "var(--color-neutral-800)" }}>
                                    {d.clockIn} – {d.clockOut ?? (d.open ? "now" : "not ended")}
                                  </span>
                                )}
                                {d.minutes > 0 && <b style={{ fontSize: 11.5 }}>{hours(d.minutes)}</b>}
                                {d.markedBy && <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>by {d.markedBy}</span>}
                              </>
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>Not recorded</span>
                            )}
                            {marks && (m.id !== session.membershipId || day !== today) && (
                              <MarkDay status={d?.status ?? null} onMark={markAttendance.bind(null, m.id, day)} />
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: "10px 0 10px 8px", verticalAlign: "top", textAlign: "right" }}>
                    <b style={{ fontSize: 15 }}>{hours(total) || "—"}</b>
                    <div style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                      {present} {present === 1 ? "day" : "days"} in
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
