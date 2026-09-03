import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bar,
  Kicker,
  LinkAction,
  OutlineButton,
  PrimaryButton,
  SectionTitle,
  Tag,
} from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { config } from "@/lib/config";
import { aiLearned, commercialRecord, consent, linkedRecords } from "@/lib/data";
import { getCustomer } from "@/lib/queries/customers";

const money = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

const monthYear = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;

const initialsOf = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export default async function Customer360Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { brand } = await getConsoleContext();

  // `slug` is the customer id; the lookup is brand-scoped, so a member of one
  // brand cannot reach another brand's customer by guessing an id.
  const record = await getCustomer(brand.id, slug);
  if (!record) notFound();

  const { customer, score, signals: signalRows, conversations } = record;

  const identity = [
    customer.phone,
    customer.email,
    customer.location,
    monthYear(customer.customerSince) && `Customer since ${monthYear(customer.customerSince)}`,
    customer.externalRef && `ID · ${customer.externalRef}`,
  ].filter(Boolean) as string[];

  const breakdown = (score?.breakdown ?? {}) as {
    contributions?: { axisLabel: string; value: number; weight: number; contribution: number }[];
    rules?: { name: string; effect: number; authorName: string | null }[];
  };
  const contributions = (breakdown.contributions ?? []).slice(0, 4);
  const rules = breakdown.rules ?? [];

  // Signals render against the brand's own median, not a global constant.
  const median =
    signalRows.length > 0
      ? signalRows.map((r) => r.signal.value).sort((a, b) => a - b)[Math.floor(signalRows.length / 2)]
      : 50;

  return (
    <section>
      {/* Identity header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            width: 56,
            height: 56,
            background: "var(--color-text)",
            color: "var(--color-bg)",
            fontWeight: 800,
            fontSize: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initialsOf(customer.name)}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: "-0.028em",
                lineHeight: 1,
              }}
            >
              {customer.name}
            </h1>
            {conversations.some((c) => c.status === "live") && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  background: "var(--color-accent)",
                  color: "var(--color-bg)",
                  padding: "4px 8px",
                }}
              >
                On call
              </span>
            )}
            {[customer.tier, customer.segment].filter(Boolean).map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  border: "2px solid var(--color-text)",
                  padding: "2px 8px",
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 18,
              fontSize: 12.5,
              color: "var(--color-neutral-800)",
              flexWrap: "wrap",
            }}
          >
            {identity.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryButton href="/app/live">Join the call</PrimaryButton>
          <OutlineButton>Assign owner</OutlineButton>
          <OutlineButton style={{ padding: "8px 12px" }}>···</OutlineButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px" }}>
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {/* Score and its rationale */}
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "2px solid var(--color-divider)",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 28 }}>
              <div style={{ flexShrink: 0 }}>
                <Kicker>Blended priority</Kicker>
                <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: 56,
                      lineHeight: 0.9,
                      letterSpacing: "-0.04em",
                      color: "var(--color-accent)",
                    }}
                  >
                    {score ? Math.round(score.blended) : "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>of 100</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--color-neutral-800)" }}>
                  Model {score ? Math.round(score.modelScore) : "—"} · overrides{" "}
                  <b style={{ color: "var(--color-accent-700)" }}>
                    {score && score.overrideDelta >= 0 ? "+" : ""}
                    {score ? score.overrideDelta : 0}
                  </b>
                </div>
              </div>

              {config.showAiRationale && (
                <div style={{ flex: 1 }}>
                  <Kicker
                    style={{ paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-400)" }}
                  >
                    Why this number
                  </Kicker>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      fontSize: 12.5,
                    }}
                  >
                    {contributions.map((b) => (
                      <div key={b.axisLabel} style={{ display: "flex", gap: 12 }}>
                        <span style={{ width: 210, color: "var(--color-neutral-800)" }}>
                          {b.axisLabel} {Math.round(b.value)} × weight {b.weight.toFixed(2)}
                        </span>
                        <b
                          style={{
                            width: 44,
                            color:
                              b.contribution >= 8
                                ? "var(--color-accent-700)"
                                : "var(--color-neutral-800)",
                          }}
                        >
                          +{b.contribution}
                        </b>
                      </div>
                    ))}
                    {rules.map((r) => (
                      <div
                        key={r.name}
                        style={{
                          display: "flex",
                          gap: 12,
                          paddingTop: 7,
                          borderTop: "1px solid var(--color-neutral-400)",
                        }}
                      >
                        <span style={{ width: 210, fontWeight: 700 }}>Rule · &ldquo;{r.name}&rdquo;</span>
                        <b style={{ width: 44, color: "var(--color-accent-700)" }}>
                          {r.effect >= 0 ? "+" : ""}
                          {r.effect}
                        </b>
                        <span style={{ color: "var(--color-neutral-700)" }}>
                          {r.authorName ? `Written by ${r.authorName}` : "Automatic"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Conversation history */}
          <div style={{ padding: "16px 24px 12px", display: "flex", alignItems: "baseline", gap: 14 }}>
            <SectionTitle>Conversation history</SectionTitle>
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              {conversations.length} contact{conversations.length === 1 ? "" : "s"} · every channel,
              one thread
            </span>
            <LinkAction href="/app/conversations" style={{ marginLeft: "auto" }}>
              Open archive →
            </LinkAction>
          </div>

          <div style={{ borderTop: "2px solid var(--color-divider)" }}>
            {conversations.length === 0 && (
              <div style={{ padding: "18px 24px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
                No conversations recorded yet. They appear here the moment the AI or a colleague
                speaks to this customer on any channel.
              </div>
            )}
            {conversations.map((c) => {
              const escalated = c.outcome === "escalated";
              const ev = {
                date: c.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
                time: c.startedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
                channel: c.channel.replace("_", " "),
                chColor: c.handledBy ? "var(--color-neutral-700)" : "var(--color-accent-700)",
                title: c.intent ?? "Conversation",
                outcome: (c.outcome ?? c.status).replace(/_/g, " "),
                tagBg: escalated ? "var(--color-accent-200)" : "var(--color-neutral-200)",
                tagFg: escalated ? "var(--color-accent-800)" : "var(--color-neutral-800)",
                handled: c.handledBy ?? "AI only",
                summary: "",
                duration: c.durationSeconds ? `${Math.round(c.durationSeconds / 60)}m` : "—",
                sentiment: c.sentimentEnd?.toFixed(2) ?? "—",
                cited: "",
              };
              return (
              <div
                key={c.id}
                className="hov-surface"
                style={{
                  display: "grid",
                  gridTemplateColumns: "108px 1fr",
                  borderBottom: "1px solid var(--color-neutral-300)",
                }}
              >
                <div
                  style={{
                    padding: "13px 12px 13px 24px",
                    borderRight: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>{ev.date}</div>
                  <div style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>{ev.time}</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: ev.chColor,
                    }}
                  >
                    {ev.channel}
                  </div>
                </div>
                <div style={{ padding: "13px 24px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <b style={{ fontSize: 13 }}>{ev.title}</b>
                    <Tag bg={ev.tagBg} fg={ev.tagFg}>
                      {ev.outcome}
                    </Tag>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>
                      {ev.handled}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      color: "var(--color-neutral-800)",
                      lineHeight: 1.45,
                    }}
                  >
                    {ev.summary}
                  </div>
                  <div
                    style={{
                      marginTop: 7,
                      display: "flex",
                      gap: 14,
                      fontSize: 11,
                      color: "var(--color-neutral-700)",
                    }}
                  >
                    <span>Duration {ev.duration}</span>
                    <span>Sentiment {ev.sentiment}</span>
                    <span>{ev.cited}</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {/* Commercial record */}
          <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)" }}>
            <h2
              style={{
                margin: "0 0 12px",
                fontWeight: 800,
                fontSize: 17,
                letterSpacing: "-0.015em",
              }}
            >
              Commercial record
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                borderTop: "2px solid var(--color-divider)",
              }}
            >
              {commercialRecord.map((m, i) => {
                const value = m.label === "Lifetime value" ? money(customer.ltvPence) : m.value;
                return (
                <div
                  key={m.label}
                  style={{
                    padding:
                      i === 0
                        ? "14px 16px 14px 0"
                        : i === commercialRecord.length - 1
                          ? "14px 0 14px 16px"
                          : "14px 16px",
                    borderRight:
                      i < commercialRecord.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                  }}
                >
                  <Kicker style={{ letterSpacing: "0.12em" }}>{m.label}</Kicker>
                  <div
                    style={{ marginTop: 6, fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11.5,
                      color: m.hot ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                    }}
                  >
                    {m.note}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Signals
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                vs. Tier 1 median
              </span>
            </div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 11 }}>
              {signalRows.map(({ signal, axis }) => {
                // Accent when the axis is pushing priority up, not merely high.
                const oriented = axis.inverted ? 100 - signal.value : signal.value;
                const color =
                  oriented >= 70 ? "var(--color-accent)" : "var(--color-neutral-700)";
                const delta = Math.round(signal.value - median);
                return (
                  <div key={axis.key}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                      <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{axis.label}</span>
                      <b style={{ color }}>{signal.display ?? Math.round(signal.value)}</b>
                      <span
                        style={{
                          width: 34,
                          textAlign: "right",
                          fontSize: 10.5,
                          color: "var(--color-neutral-700)",
                        }}
                      >
                        {delta >= 0 ? "+" : ""}
                        {delta}
                      </span>
                    </div>
                    <Bar
                      width={`${Math.round(signal.value)}%`}
                      color={color}
                      height={5}
                      marker="median"
                      markerAt={`${Math.round(median)}%`}
                      style={{ marginTop: 4 }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {config.showAiRationale && (
            <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
              <Kicker>What the AI has learned</Kicker>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  fontSize: 12,
                  color: "var(--color-neutral-800)",
                  lineHeight: 1.45,
                }}
              >
                {aiLearned.map((l) => (
                  <div key={l} style={{ display: "flex", gap: 9 }}>
                    <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>→</span>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              <LinkAction size={11} style={{ marginTop: 12, display: "block" }}>
                Edit what the AI may use →
              </LinkAction>
            </div>
          )}

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Household &amp; linked records</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 12.5,
              }}
            >
              {linkedRecords.map((r) => (
                <div
                  key={r.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <span>{r.name}</span>
                  <span style={{ color: "var(--color-neutral-700)" }}>{r.note}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>2 devices · 1 app login</span>
                <LinkAction size={11}>View</LinkAction>
              </div>
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Consent &amp; compliance</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 12,
                color: "var(--color-neutral-800)",
              }}
            >
              {consent.map((c) => (
                <div key={c.label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{c.label}</span>
                  <b>{c.value}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
