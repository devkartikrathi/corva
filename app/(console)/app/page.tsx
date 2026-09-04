import Link from "next/link";
import {
  Bar,
  Kicker,
  LinkAction,
  LiveDot,
  OutlineButton,
  PrimaryButton,
  ScreenTitle,
  SectionTitle,
  StackedBar,
  Tag,
  Th,
} from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { takeOverCall } from "@/lib/actions/conversations";
import { getConsoleContext } from "@/lib/auth/context";
import { hourlyVolume } from "@/lib/queries/analytics";
import { docGaps, headlineStats, liveCalls, needsHuman, scoreMovers } from "@/lib/queries/command";
import { priorityQueue } from "@/lib/queries/customers";
import { listSavedViews } from "@/lib/queries/views";

export default async function CommandCenterPage() {
  const { session, brand } = await getConsoleContext();

  const [stats, live, queue, waiting, gaps, movers, volume, views] = await Promise.all([
    headlineStats(brand.id),
    liveCalls(brand.id),
    priorityQueue(brand.id),
    needsHuman(brand.id),
    docGaps(brand.id),
    scoreMovers(brand.id),
    hourlyVolume(brand.id),
    listSavedViews(session.orgId, "customers"),
  ]);

  return (
    <section>
      <div
        style={{
          padding: "24px 24px 20px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "flex-end",
          gap: 24,
        }}
      >
        <ScreenTitle kicker={brand.name} title="Command center" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Saved views</span>
          {views
            .filter((v) => !v.isDefault)
            .map((v) => (
              <OutlineButton key={v.id} href={v.href} style={{ fontSize: 11, padding: "6px 10px", borderWidth: 1 }}>
                {v.name}
              </OutlineButton>
            ))}
          <PrimaryButton href="/app/customers" style={{ fontWeight: 600 }}>
            All customers →
          </PrimaryButton>
        </div>
      </div>

      {/* Headline numbers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            style={{
              padding: "16px 20px",
              borderRight: i < stats.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
            }}
          >
            <Kicker style={{ letterSpacing: "0.12em" }}>{stat.label}</Kicker>
            <div
              style={{
                marginTop: 8,
                fontWeight: 800,
                fontSize: 32,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: stat.accent ? "var(--color-accent-700)" : undefined,
              }}
            >
              {stat.value}
              {stat.unit && (
                <span style={{ fontSize: 16, color: "var(--color-neutral-700)" }}>{stat.unit}</span>
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              {stat.note}
            </div>
          </div>
        ))}
      </div>

      {/* Live right now */}
      <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LiveDot />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Live right now
          </span>
          <span style={{ height: 1, flex: 1, background: "var(--color-neutral-300)" }} />
          <LinkAction href="/app/live">Open call console →</LinkAction>
        </div>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}
        >
          {live.length === 0 && (
            <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--color-neutral-700)" }}>
              Nothing live. The AI is answering as contacts arrive — this fills as they do.
            </p>
          )}
          {live.map((c) => (
            <div
              key={c.id}
              style={
                c.hot
                  ? { border: "2px solid var(--color-text)", background: "var(--color-bg)", padding: "12px 14px" }
                  : {
                      border: "1px solid var(--color-neutral-400)",
                      background: "var(--color-surface)",
                      padding: "12px 14px",
                    }
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</span>
                {c.hot ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: "var(--color-accent)",
                      color: "var(--color-bg)",
                      padding: "2px 6px",
                    }}
                  >
                    {c.priority}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      border: "1px solid var(--color-neutral-700)",
                      padding: "1px 5px",
                      color: "var(--color-neutral-800)",
                    }}
                  >
                    {c.priority}
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                  {c.channel.replace("_", " ")} · {c.elapsed}
                </span>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-neutral-800)" }}>
                Intent · <b>{c.intent}</b>
              </div>

              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-neutral-700)",
                  }}
                >
                  Sentiment
                </span>
                <Bar
                  width={c.sentimentBar}
                  color={c.negative ? "var(--color-accent)" : "var(--color-neutral-700)"}
                  height={5}
                  style={{ flex: 1 }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: c.negative ? "var(--color-accent-700)" : "var(--color-neutral-800)",
                  }}
                >
                  {c.sentiment}
                </span>
              </div>

              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <ActionButton
                  variant="primary"
                  pendingLabel="Joining…"
                  style={{ fontSize: 11, padding: "7px 10px" }}
                  action={async () => {
                    "use server";
                    await takeOverCall(c.id);
                  }}
                >
                  Take the line
                </ActionButton>
                <Link
                  href={`/app/live?call=${c.id}`}
                  className="hov-invert"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    border: "1px solid var(--color-text)",
                    padding: "6px 10px",
                    color: "var(--color-text)",
                  }}
                >
                  Listen in
                </Link>
                {c.tier && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {c.tier}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 356px" }}>
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {/* Priority queue */}
          <div style={{ padding: "16px 24px 12px", display: "flex", alignItems: "baseline", gap: 12 }}>
            <SectionTitle>Priority queue</SectionTitle>
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              Blended score · brand overrides applied
            </span>
            <LinkAction href="/app/customers" style={{ marginLeft: "auto" }}>
              All customers →
            </LinkAction>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr
                style={{
                  borderTop: "2px solid var(--color-divider)",
                  borderBottom: "2px solid var(--color-divider)",
                }}
              >
                <Th padding="8px 24px">Customer</Th>
                <Th width={92} padding="8px 12px">Priority</Th>
                <Th padding="8px 12px">Why it&rsquo;s high</Th>
                <Th width={96} padding="8px 12px">Value</Th>
                <Th width={150} padding="8px 24px">Next action</Th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr
                  key={row.id}
                  className="hov-surface"
                  style={{ borderBottom: "1px solid var(--color-neutral-300)" }}
                >
                  <td style={{ padding: "11px 24px" }}>
                    <Link href={`/app/customers/${row.id}`} style={{ textAlign: "left", color: "var(--color-text)" }}>
                      <b style={{ fontSize: 13 }}>{row.name}</b>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                        {row.meta}
                      </span>
                    </Link>
                  </td>
                  <td style={{ padding: "11px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <b style={{ fontSize: 15, color: row.pColor }}>{row.priority}</b>
                      <Bar width={row.pBar} color={row.pColor} height={5} style={{ width: 34 }} />
                    </span>
                  </td>
                  <td style={{ padding: "11px 12px", color: "var(--color-neutral-800)" }}>{row.why}</td>
                  <td style={{ padding: "11px 12px", fontWeight: 700 }}>{row.value}</td>
                  <td style={{ padding: "11px 24px" }}>
                    <Tag bg={row.actionBg} fg={row.actionFg} size={11} padding="4px 8px">
                      {row.action}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Contact volume */}
          <div style={{ padding: "18px 24px", borderTop: "2px solid var(--color-divider)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <SectionTitle>Contact volume &amp; containment</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>Hourly, today</span>
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "flex-end",
                gap: 6,
                height: 116,
                borderBottom: "2px solid var(--color-divider)",
              }}
            >
              {volume.map((bar, i) => (
                <StackedBar key={i} ai={bar.ai} human={bar.human} />
              ))}
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 18,
                fontSize: 11,
                color: "var(--color-neutral-700)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, background: "var(--color-accent)", display: "block" }} />
                Resolved by AI
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, background: "var(--color-neutral-400)", display: "block" }} />
                Handed to a human
              </span>
              <span style={{ marginLeft: "auto" }}>08:00 → 21:00</span>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Needs a human</Kicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {waiting.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
                  The queue is empty. Every conversation is with the AI.
                </p>
              )}
              {waiting.map((h) => (
                <Link
                  key={h.id}
                  href={`/app/handoffs?handoff=${h.id}`}
                  className="hov-raise"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderLeft: `3px solid ${h.urgent ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                    background: "var(--color-surface)",
                    padding: "10px 12px",
                    color: "var(--color-text)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <b style={{ fontSize: 12.5 }}>{h.name}</b>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        fontWeight: 700,
                        color: h.urgent ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                      }}
                    >
                      {h.wait}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      fontSize: 11.5,
                      color: "var(--color-neutral-800)",
                      lineHeight: 1.4,
                    }}
                  >
                    {h.note}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Documentation gaps found by the AI</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 9,
                fontSize: 12,
              }}
            >
              {gaps.map((g) => (
                <div key={g.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <b
                    style={{
                      width: 26,
                      color: g.hot ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                    }}
                  >
                    {g.count}
                  </b>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{g.text}</span>
                  <LinkAction href={`/app/knowledge?gap=${g.id}`} size={11}>
                    {g.cta}
                  </LinkAction>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Score movers · last 24h</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 12,
              }}
            >
              {movers.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
                  No score has moved since the last run. Movements appear here as soon as a
                  signal or a rule changes one.
                </p>
              )}
              {movers.map((m, i) => (
                <Link
                  key={m.id}
                  href={`/app/customers/${m.id}`}
                  className="hov-ink"
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    paddingBottom: i < movers.length - 1 ? 9 : undefined,
                    borderBottom:
                      i < movers.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                    color: "var(--color-text)",
                  }}
                >
                  <b style={{ flex: 1 }}>{m.name}</b>
                  <span style={{ color: "var(--color-neutral-700)" }}>{m.axis}</span>
                  <b style={{ color: m.hot ? "var(--color-accent-700)" : "var(--color-neutral-800)" }}>
                    {m.delta}
                  </b>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
