import Link from "next/link";
import { Bar, Kicker, ScreenHeader, ScreenRefusal, StatRow, Th } from "@/components/ui";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { accountState } from "@/lib/billing/usage";
import { teamPerformance } from "@/lib/queries/analytics";
import { formatRupees } from "@/lib/money";

/**
 * How the people are doing.
 *
 * Every other screen in this console is about the AI — what it answered, what
 * it cited, where it stopped. This one is the manager's question instead: who
 * is carrying what, who picks a customer up quickly, and which accounts nobody
 * is holding at all.
 *
 * Deliberately not a leaderboard. There is no composite score and nothing is
 * ranked by "best", because the columns measure different jobs and adding them
 * up would invent a comparison the data does not support. It is sorted by
 * volume, which is a fact rather than a verdict.
 *
 * An Agent cannot open it. That is not because the numbers are secret — they
 * are their own numbers — but because a table of colleagues is a different
 * artefact from a record of your own work, and only one of them is useful to
 * the person being measured.
 */
export default async function TeamPerformancePage() {
  const { session, brand, denied } = await guardScreen("team.performance");
  // The nav hides this from an Agent; this is what makes hiding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="Team performance"
        reason={refusalReason(denied)}
        next="Your own work is on the command centre and in the archive."
      />
    );
  }

  const account = await accountState(session.orgId);
  if (!account.plan.management) {
    return (
      <section style={{ padding: "24px 24px 0" }}>
        <ScreenHeader
          kicker="On the Growth plan"
          title="Team performance"
          lede={`Leads owned and won, follow-ups done on time and handoffs picked up, per person. It comes with the Growth plan — you are on ${account.plan.name}.`}
        />
        <p style={{ marginTop: 14 }}>
          <Link href="/app/billing" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
            See plans in Billing →
          </Link>
        </p>
      </section>
    );
  }

  const { people, totals } = await teamPerformance(session.orgId, brand.id);

  const busiest = Math.max(1, ...people.map((p) => p.leadsTotal));

  const kpis = [
    { label: "Open leads", value: String(totals.leadsOpen), note: "across the team", hot: false },
    {
      label: "Won",
      value: String(totals.leadsWon),
      note: totals.wonPaise ? `worth ${formatRupees(totals.wonPaise)}` : "no value recorded",
      hot: false,
    },
    {
      label: "Follow-ups overdue",
      value: String(totals.followUpsOverdue),
      note: totals.followUpsOverdue ? "promises not yet kept" : "every promise on time",
      hot: totals.followUpsOverdue > 0,
    },
    {
      label: "Handoffs in hand",
      value: String(totals.open),
      note: `${totals.accepted} taken · ${totals.resolved} closed`,
      hot: totals.open > totals.available,
    },
    {
      label: "Free to take a call",
      value: `${totals.available} of ${totals.people}`,
      note: totals.available === 0 ? "nobody is available" : "by their own setting",
      hot: totals.available === 0,
    },
  ];

  const dash = <span style={{ color: "var(--color-neutral-500)" }}>—</span>;
  const sub = { display: "block", marginTop: 3, fontSize: 11, color: "var(--color-neutral-700)" } as const;

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${totals.people} on the team · ${totals.available} free now`}
        title="Team performance"
        lede="Who owns which leads and how many they win, whether callbacks happen when the AI promised them, and how fast a handed-over customer gets picked up."
      />

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, borderBottom: "2px solid var(--color-divider)" }}>
        {kpis.map((k, i) => (
          <div key={k.label} style={{ padding: "16px 20px", borderRight: i < kpis.length - 1 ? "1px solid var(--color-neutral-300)" : undefined }}>
            <Kicker>{k.label}</Kicker>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: 27, letterSpacing: "-0.028em", color: k.hot ? "var(--color-accent-700)" : undefined }}>
              {k.value}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--color-neutral-700)" }}>{k.note}</div>
          </div>
        ))}
      </div>

      {people.length === 0 ? (
        <p style={{ padding: "20px 24px", fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "56ch" }}>
          Nobody on {brand.name} can be handed work yet. Invite an Agent or a Manager from{" "}
          <Link href="/app/team" style={{ fontWeight: 600, color: "var(--color-text)" }}>
            People &amp; roles
          </Link>
          , and every column here fills itself from the work they do.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
              <Th padding="9px 24px">Person</Th>
              <Th>Right now</Th>
              <Th width={190}>Leads owned</Th>
              <Th width={110}>Conversion</Th>
              <Th width={170}>Follow-ups</Th>
              <Th width={150}>Handoffs</Th>
              <Th width={90}>Rating</Th>
              <Th width={150} padding="9px 24px 9px 10px">
                Accounts held
              </Th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.membershipId} style={{ borderBottom: "1px solid var(--color-neutral-300)", verticalAlign: "top" }}>
                <td style={{ padding: "11px 24px" }}>
                  <b style={{ fontSize: 13 }}>{p.name}</b>
                  <span style={sub}>{p.role}</span>
                </td>

                <td style={{ padding: "11px 10px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        display: "block",
                        background:
                          p.availability === "available"
                            ? "var(--color-accent)"
                            : p.availability === "busy"
                              ? "var(--color-neutral-700)"
                              : "var(--color-neutral-400)",
                      }}
                    />
                    {p.availability === "available" ? "Available" : p.availability === "busy" ? "On a call" : "Offline"}
                  </span>
                  {p.open > 0 && <span style={{ ...sub, color: "var(--color-accent-700)" }}>{p.open} handoff{p.open === 1 ? "" : "s"} in hand</span>}
                </td>

                <td style={{ padding: "11px 10px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 12.5, width: 26 }}>{p.leadsTotal}</b>
                    <Bar width={`${Math.round((p.leadsTotal / busiest) * 100)}%`} color="var(--color-neutral-700)" style={{ flex: 1 }} />
                  </span>
                  <span style={sub}>
                    {p.leadsOpen} open · {p.leadsWon} won · {p.leadsLost} lost
                  </span>
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.conversion === null ? dash : <b>{p.conversion}%</b>}
                  {p.wonPaise > 0 && <span style={sub}>{formatRupees(p.wonPaise)}</span>}
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.followUpsDone + p.followUpsOpen === 0 ? (
                    dash
                  ) : (
                    <>
                      <b>{p.followUpsDone}</b> done
                      {p.onTimeRate !== null && (
                        <span style={{ color: p.onTimeRate >= 80 ? "var(--color-neutral-800)" : "var(--color-accent-700)" }}>
                          {" "}
                          · {p.onTimeRate}% on time
                        </span>
                      )}
                      <span style={{ ...sub, color: p.followUpsOverdue ? "var(--color-accent-700)" : sub.color }}>
                        {p.followUpsOpen} open{p.followUpsOverdue ? `, ${p.followUpsOverdue} overdue` : ""}
                      </span>
                    </>
                  )}
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.accepted === 0 ? (
                    dash
                  ) : (
                    <>
                      <b>{p.accepted}</b> taken{p.closeRate !== null && ` · ${p.closeRate}% closed`}
                      <span style={sub}>pick-up {p.pickup}</span>
                    </>
                  )}
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.rating === null ? dash : <b>{p.rating.toFixed(1)}★</b>}
                  {p.reviewScore !== null && <span style={sub}>reviews {p.reviewScore.toFixed(1)}</span>}
                </td>

                <td style={{ padding: "11px 24px 11px 10px", fontSize: 12.5 }}>
                  <b>{p.customers}</b>
                  <span style={sub}>{p.book} lifetime value</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* How routing reads the table above. Written out because a queue that
          chooses a person and never says why is a queue people distrust. */}
      <div
        style={{
          padding: "18px 24px 28px",
          borderTop: "2px solid var(--color-divider)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          maxWidth: 940,
        }}
      >
        <div>
          <Kicker>How a transferred call picks a person</Kicker>
          <ol
            style={{
              margin: "11px 0 0",
              paddingLeft: 18,
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "var(--color-neutral-800)",
            }}
          >
            <li>Whoever is already talking to that customer, if they are free.</li>
            <li>Whoever owns the account.</li>
            <li>Free, highest rated, lightest queue — in that order.</li>
          </ol>
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.55 }}>
            Passing on a call re-routes it and records who passed, so it is not offered
            straight back. If nobody is free it stays in the queue unassigned rather than
            landing on someone who said they could not take it.
          </p>
        </div>
        <div>
          <Kicker>What these columns are not</Kicker>
          <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 7 }}>
            <StatRow label="Conversion" value="Won out of won + lost — open leads do not count against anyone" />
            <StatRow label="On time" value="Done within an hour of when it was promised" />
            <StatRow label="Pick-up" value="Median, so one bad night cannot skew it" />
            <StatRow
              label="Accounts held"
              value={`${formatRupees(people.reduce((a, p) => a + p.bookPaise, 0))} across the team`}
            />
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.55 }}>
            There is no combined score. The columns measure different jobs, and adding them
            together would invent a comparison none of them supports.
          </p>
        </div>
      </div>
    </section>
  );
}
