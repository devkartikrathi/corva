import Link from "next/link";
import { after } from "next/server";
import { syncIfStale } from "@/lib/email/mailbox";
import { Kicker, ScreenHeader, SectionTitle } from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { accountState } from "@/lib/billing/usage";
import { hours } from "@/lib/people/attendance";
import { businessOverview, type PersonRow } from "@/lib/queries/overview";

/**
 * Overview: the business's customers and the people serving them, drawn.
 *
 * One screen, read differently down the pyramid. An owner or manager sees
 * every customer channel and every person; someone on the team sees the same
 * customer picture and their own line of work. Nothing here is about orders —
 * that is the business's own system's job.
 */

const PERIODS = [7, 14, 30];
const AI = "var(--color-accent)";
const PEOPLE = "var(--color-neutral-800)";
const WAITING = "var(--color-neutral-400)";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Swatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-neutral-700)" }}>
      <span style={{ width: 10, height: 10, background: color, display: "block" }} />
      {children}
    </span>
  );
}

/** One measure of a person's work, as a bar against the busiest person. */
function Measure({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 34px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
      <span style={{ color: "var(--color-neutral-700)" }}>{label}</span>
      <span style={{ height: 8, background: "var(--color-neutral-300)", position: "relative", display: "block" }}>
        <span style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
      </span>
      <b style={{ textAlign: "right" }}>{value}</b>
    </div>
  );
}

function Person({ p, max, days, you }: { p: PersonRow; max: Record<"calls" | "chats" | "followUpsDone" | "handoffs", number>; days: number; you: boolean }) {
  return (
    <div style={{ border: "1px solid var(--color-neutral-300)", padding: "14px 16px", background: "var(--color-bg)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          title={p.atWork ? "At work now" : "Not clocked in"}
          style={{ width: 8, height: 8, borderRadius: 4, background: p.atWork ? "var(--color-accent)" : "var(--color-neutral-400)", display: "block", alignSelf: "center" }}
        />
        <b style={{ fontSize: 14 }}>{p.name}</b>
        {you && <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>you</span>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)", textTransform: "capitalize" }}>{p.role}</span>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        <Measure label="Calls taken" value={p.calls} max={max.calls} color={PEOPLE} />
        <Measure label="Chats taken" value={p.chats} max={max.chats} color={PEOPLE} />
        <Measure label="Handoffs picked up" value={p.handoffs} max={max.handoffs} color={PEOPLE} />
        <Measure label="Follow-ups done" value={p.followUpsDone} max={max.followUpsDone} color={PEOPLE} />
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-neutral-300)", fontSize: 11.5 }}>
        <span>
          <b style={{ fontSize: 14 }}>{p.daysPresent}</b> <span style={{ color: "var(--color-neutral-700)" }}>of {days} days in</span>
        </span>
        <span>
          <b style={{ fontSize: 14 }}>{hours(p.minutes) || "0h"}</b> <span style={{ color: "var(--color-neutral-700)" }}>at work</span>
        </span>
        <span>
          <b style={{ fontSize: 14 }}>{p.leadsWon}</b> <span style={{ color: "var(--color-neutral-700)" }}>won</span>
        </span>
      </div>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { session, brand } = await getConsoleContext();
  const asked = Number((await searchParams).days);
  const days = PERIODS.includes(asked) ? asked : 14;

  const seesTeam = can(session.actor, "team.performance").grant !== "none";
  const account = await accountState(session.orgId);
  const team = seesTeam && account.plan.management;
  // Customers who wrote in since the last look are counted on the next one.
  after(() => syncIfStale(brand));
  const data = await businessOverview(session.orgId, brand.id, days, team ? undefined : session.membershipId);

  const { conversations: c } = data;
  const tallest = Math.max(1, ...data.series.map((d) => d.ai + d.people + d.waiting));
  const widest = Math.max(1, ...data.channels.map((ch) => ch.total));
  const max = {
    calls: Math.max(1, ...data.people.map((p) => p.calls)),
    chats: Math.max(1, ...data.people.map((p) => p.chats)),
    handoffs: Math.max(1, ...data.people.map((p) => p.handoffs)),
    followUpsDone: Math.max(1, ...data.people.map((p) => p.followUpsDone)),
  };
  const agent = brand.agentName ?? "The AI";
  const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", ...opts });

  const headline = [
    { label: "Customers", value: String(data.customers.total), note: `${data.customers.fresh} new in ${days} days` },
    { label: `Conversations · ${days} days`, value: String(c.total), note: `across ${data.channels.length || "no"} ${data.channels.length === 1 ? "channel" : "channels"}` },
    { label: `Answered by ${agent}`, value: `${pct(c.ai, c.total)}%`, note: `${c.ai} without a person` },
    { label: "Answered by people", value: `${pct(c.people, c.total)}%`, note: c.waiting ? `${c.people} taken by the team · ${c.waiting} emails awaiting a reply` : `${c.people} taken by the team` },
    ...(team ? [{ label: "At work now", value: String(data.atWorkNow), note: `of ${data.people.length} on the team` }] : []),
  ];

  return (
    <section>
      <ScreenHeader kicker={brand.name} title="Overview" lede="Your customers, who answered them, and who was at work.">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/app/overview?days=${p}`}
            className={p === days ? undefined : "hov-invert"}
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              padding: "7px 11px",
              border: "1px solid var(--color-neutral-400)",
              background: p === days ? "var(--color-text)" : undefined,
              color: p === days ? "var(--color-bg)" : undefined,
            }}
          >
            {p} days
          </Link>
        ))}
      </ScreenHeader>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${headline.length}, 1fr)`, borderBottom: "2px solid var(--color-divider)" }}>
        {headline.map((h, i) => (
          <div key={h.label} style={{ padding: "18px 24px", borderInlineStart: i ? "1px solid var(--color-neutral-300)" : undefined }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>{h.label}</Kicker>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: 30, lineHeight: 1, letterSpacing: "-0.03em" }}>{h.value}</div>
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--color-neutral-700)" }}>{h.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", borderBottom: "2px solid var(--color-divider)" }}>
        {/* Day by day: who answered */}
        <div style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <SectionTitle>Who answered, day by day</SectionTitle>
            <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
              <Swatch color={AI}>{agent}</Swatch>
              <Swatch color={PEOPLE}>People</Swatch>
              {c.waiting > 0 && <Swatch color={WAITING}>Awaiting a reply</Swatch>}
            </span>
          </div>
          {c.total === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 16 }}>No conversations in these {days} days yet.</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: days > 14 ? 3 : 6, height: 190, marginTop: 18 }}>
              {data.series.map((d) => {
                const total = d.ai + d.people + d.waiting;
                return (
                  <div key={d.day} title={`${dayLabel(d.day, { day: "numeric", month: "short" })}: ${d.ai} by ${agent}, ${d.people} by people`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", minWidth: 0 }}>
                    <span style={{ fontSize: 10.5, textAlign: "center", color: "var(--color-neutral-700)", marginBottom: 3 }}>{total || ""}</span>
                    <span style={{ display: "block", height: `${(d.waiting / tallest) * 150}px`, background: WAITING, marginBottom: d.waiting && (d.people || d.ai) ? 2 : 0 }} />
                    <span style={{ display: "block", height: `${(d.people / tallest) * 150}px`, background: PEOPLE }} />
                    <span style={{ display: "block", height: `${(d.ai / tallest) * 150}px`, background: AI, marginTop: d.people && d.ai ? 2 : 0 }} />
                    <span style={{ display: "block", borderTop: "1px solid var(--color-neutral-400)", fontSize: 10, textAlign: "center", paddingTop: 4, color: "var(--color-neutral-700)", whiteSpace: "nowrap", overflow: "hidden" }}>
                      {days > 14 ? dayLabel(d.day, { day: "numeric" }) : dayLabel(d.day, { day: "numeric", month: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By channel */}
        <div style={{ padding: "20px 24px", borderInlineStart: "1px solid var(--color-neutral-300)" }}>
          <SectionTitle>How customers reached you</SectionTitle>
          <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
            {data.channels.length === 0 && <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)", margin: 0 }}>Nothing yet.</p>}
            {data.channels.map((ch) => (
              <div key={ch.channel}>
                <div style={{ display: "flex", fontSize: 12.5, marginBottom: 5 }}>
                  <b>{ch.label}</b>
                  <span style={{ marginLeft: "auto", color: "var(--color-neutral-700)" }}>
                    {ch.total} · {ch.customers} known {ch.customers === 1 ? "customer" : "customers"}
                  </span>
                </div>
                <div style={{ display: "flex", height: 12, width: `${Math.max(6, (ch.total / widest) * 100)}%`, gap: 2 }}>
                  <span style={{ flex: ch.ai, background: AI }} />
                  <span style={{ flex: ch.people, background: PEOPLE }} />
                  <span style={{ flex: ch.waiting, background: WAITING }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--color-neutral-700)", marginTop: 4 }}>
                  {ch.channel === "email"
                    ? `${ch.people} answered by people · ${ch.waiting} awaiting a reply`
                    : `${pct(ch.ai, ch.total)}% by ${agent} · ${pct(ch.people, ch.total)}% by people`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The people */}
      <div style={{ padding: "20px 24px 28px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
          <SectionTitle>{team ? "The team" : "Your work"}</SectionTitle>
          <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            last {days} days · the dot shows who is at work now
          </span>
          <Link href="/app/attendance" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--color-accent-700)" }}>
            Attendance →
          </Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {data.people.map((p) => (
            <Person key={p.id} p={p} max={max} days={days} you={p.id === session.membershipId} />
          ))}
        </div>
        {seesTeam && !account.plan.management && (
          <p style={{ marginTop: 14, fontSize: 12, color: "var(--color-neutral-700)" }}>
            Everyone&rsquo;s work side by side comes with the Growth plan.{" "}
            <Link href="/app/billing" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
              See plans →
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
