import Link from "next/link";
import { Bar, Kicker, ScreenHeader, ScreenRefusal, StatRow, Tag, Th } from "@/components/ui";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
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

  const { people, totals } = await teamPerformance(session.orgId, brand.id);

  const busiest = Math.max(1, ...people.map((p) => p.accepted));
  const biggestBook = Math.max(1, ...people.map((p) => p.bookPaise));

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${totals.people} who can take a call · ${totals.available} free now`}
        title="Team performance"
        lede="Who is carrying what, how fast a handed-over customer gets picked up, and which accounts no person holds."
      />

      {/* The four numbers a manager opens this screen for. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        {[
          {
            label: "Waiting or in hand",
            value: String(totals.open),
            note: totals.open === 0 ? "nothing outstanding" : "across the team right now",
            hot: totals.open > totals.available,
          },
          {
            label: "Handoffs taken",
            value: String(totals.accepted),
            note: `${totals.resolved} closed out`,
            hot: false,
          },
          {
            label: "Free to take a call",
            value: `${totals.available} of ${totals.people}`,
            note: totals.available === 0 ? "nobody is available" : "by their own setting",
            hot: totals.available === 0,
          },
          {
            /**
             * Not a failure state. A customer the AI handles start to finish
             * is the product working — this is here so a manager can see how
             * much of the book that is, and decide whether it should be.
             */
            label: "Held by the AI alone",
            value: String(totals.aiOnly),
            note: "no person assigned",
            hot: false,
          },
        ].map((k, i) => (
          <div
            key={k.label}
            style={{
              padding: "16px 20px",
              borderRight: i < 3 ? "1px solid var(--color-neutral-300)" : undefined,
            }}
          >
            <Kicker>{k.label}</Kicker>
            <div
              style={{
                marginTop: 8,
                fontWeight: 800,
                fontSize: 27,
                letterSpacing: "-0.028em",
                color: k.hot ? "var(--color-accent-700)" : undefined,
              }}
            >
              {k.value}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              {k.note}
            </div>
          </div>
        ))}
      </div>

      {people.length === 0 ? (
        <p style={{ padding: "20px 24px", fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "56ch" }}>
          Nobody on {brand.name} can be handed a call yet. Invite an Agent or a Manager from{" "}
          <Link href="/app/team" style={{ fontWeight: 600, color: "var(--color-text)" }}>
            Team &amp; roles
          </Link>
          , and every column here fills itself from the work they do.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
              <Th padding="9px 24px">Person</Th>
              <Th>Right now</Th>
              <Th width={150}>Handoffs taken</Th>
              <Th width={92}>Closed</Th>
              <Th width={92}>Pick-up</Th>
              <Th width={92}>Rating</Th>
              <Th width={92}>Reviews</Th>
              <Th width={170}>Accounts held</Th>
              <Th padding="9px 24px 9px 10px">Known for</Th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.membershipId} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                <td style={{ padding: "11px 24px" }}>
                  <b style={{ fontSize: 13 }}>{p.name}</b>
                  <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {p.role}
                  </span>
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
                    {p.availability === "available"
                      ? "Available"
                      : p.availability === "busy"
                        ? "On a call"
                        : "Offline"}
                  </span>
                  {p.open > 0 && (
                    <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--color-accent-700)" }}>
                      {p.open} in hand
                    </span>
                  )}
                </td>

                <td style={{ padding: "11px 10px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 12.5, width: 26 }}>{p.accepted}</b>
                    <Bar
                      width={`${Math.round((p.accepted / busiest) * 100)}%`}
                      color="var(--color-neutral-700)"
                      style={{ flex: 1 }}
                    />
                  </span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {p.conversations} conversation{p.conversations === 1 ? "" : "s"} handled
                  </span>
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.closeRate === null ? (
                    <span style={{ color: "var(--color-neutral-500)" }}>—</span>
                  ) : (
                    <b style={{ color: p.closeRate >= 80 ? undefined : "var(--color-accent-700)" }}>
                      {p.closeRate}%
                    </b>
                  )}
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {/* Median, not mean — one handoff that sat overnight would
                      otherwise make a good week look like a bad one. */}
                  <b
                    style={{
                      color:
                        p.pickupSeconds !== null && p.pickupSeconds > 300
                          ? "var(--color-accent-700)"
                          : undefined,
                    }}
                  >
                    {p.pickup}
                  </b>
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.rating === null ? (
                    <span style={{ color: "var(--color-neutral-500)" }}>—</span>
                  ) : (
                    <b>{p.rating.toFixed(1)}★</b>
                  )}
                </td>

                <td style={{ padding: "11px 10px", fontSize: 12.5 }}>
                  {p.reviewScore === null ? (
                    <span style={{ color: "var(--color-neutral-500)" }} title="Nobody has reviewed one of their calls yet">
                      —
                    </span>
                  ) : (
                    <b>{p.reviewScore.toFixed(1)}</b>
                  )}
                </td>

                <td style={{ padding: "11px 10px" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 12.5, width: 22 }}>{p.customers}</b>
                    <Bar
                      width={`${Math.round((p.bookPaise / biggestBook) * 100)}%`}
                      color="var(--color-neutral-500)"
                      style={{ flex: 1 }}
                    />
                  </span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {p.book} lifetime value
                  </span>
                </td>

                <td style={{ padding: "11px 24px 11px 10px" }}>
                  {p.specialities.length === 0 ? (
                    <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)" }}>—</span>
                  ) : (
                    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {p.specialities.map((sp) => (
                        <Tag
                          key={sp}
                          bg="var(--color-neutral-200)"
                          fg="var(--color-neutral-800)"
                          padding="3px 7px"
                        >
                          {sp}
                        </Tag>
                      ))}
                    </span>
                  )}
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
            <StatRow label="Rating" value="A judgement, set by a manager" />
            <StatRow label="Reviews" value="The score left on their calls, 1–5" />
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
