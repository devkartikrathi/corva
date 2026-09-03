import Link from "next/link";
import { Bar, Kicker, LinkAction, LiveDot } from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { documentsInPlay, openOrders, sentCurve, wave } from "@/lib/data";
import { loadAgentConfig } from "@/lib/agent/config";
import { formatPence } from "@/lib/agent/authority";
import { getLiveCall } from "@/lib/queries/conversations";

export default async function LiveCallPage() {
  const { brand } = await getConsoleContext();
  const call = await getLiveCall(brand.id);

  if (!call) {
    return (
      <section style={{ padding: "20px 24px" }}>
        <h1 style={{ margin: 0, fontWeight: 800, fontSize: 30, letterSpacing: "-0.028em" }}>
          No call in progress
        </h1>
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "52ch" }}>
          When a customer reaches {brand.name} on any channel, the transcript streams here with the
          document behind every answer, and you can take the line at any point.
        </p>
      </section>
    );
  }

  const config = await loadAgentConfig(brand.id);
  const callerFacts = call.facts;
  const transcript = call.turns;
  const callActions = call.actions;

  // The entitlement rail is the live agent version's authority table, not a
  // copy of it — change a ceiling in Tuning and this moves.
  const entitlements = (config?.authority ?? []).map((a) => ({
    label: a.label,
    value: a.blocked
      ? "blocked"
      : a.ceilingPence === null
        ? "unlimited"
        : `up to ${formatPence(a.ceilingPence)}`,
    blocked: a.blocked,
  }));

  return (
    <section>
      {/* Call bar */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "var(--color-surface)",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-accent-700)",
          }}
        >
          <LiveDot size={8} />
          On call
        </span>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}>{call.elapsed}</span>
        <span style={{ height: 26, width: 2, background: "var(--color-neutral-400)" }} />
        <Link
          href={call.customer ? `/app/customers/${call.customer.id}` : "/app/customers"}
          style={{ textAlign: "left", color: "var(--color-text)" }}
        >
          <b style={{ fontSize: 15 }}>{call.customer?.name ?? "Unidentified caller"}</b>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            {[call.customer?.phone, call.customer?.phone && "verified by number", call.customer?.tier]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
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
          Priority {call.priority ?? "—"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["Listen", "Whisper to AI"].map((label) => (
            <button
              key={label}
              type="button"
              className="hov-invert"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                border: "1px solid var(--color-text)",
                padding: "7px 11px",
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="hov-accent"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "8px 13px",
            }}
          >
            Take the line
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "268px 1fr 316px",
          minHeight: "calc(100vh - 52px - 63px)",
        }}
      >
        {/* Who is calling */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Who is calling</Kicker>
            <div
              style={{
                marginTop: 11,
                display: "flex",
                flexDirection: "column",
                gap: 7,
                fontSize: 12.5,
              }}
            >
              {callerFacts.map((f) => (
                <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "var(--color-neutral-800)" }}>{f.label}</span>
                  <b style={{ color: f.hot ? "var(--color-accent-700)" : undefined }}>{f.value}</b>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Open orders</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}
            >
              {openOrders.map((o) => (
                <div
                  key={o.id}
                  style={{
                    borderLeft: `3px solid ${o.urgent ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                    paddingLeft: 9,
                  }}
                >
                  <b>{o.id}</b>
                  <span style={{ display: "block", color: "var(--color-neutral-800)" }}>{o.line}</span>
                  <span
                    style={{
                      display: "block",
                      color: o.urgent ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                    }}
                  >
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px" }}>
            <Kicker>Entitlements the AI may use</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}
            >
              {entitlements.map((e) => (
                <div key={e.label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--color-neutral-800)" }}>{e.label}</span>
                  <b style={{ color: e.blocked ? "var(--color-accent-700)" : undefined }}>{e.value}</b>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transcript */}
        <div
          style={{
            borderRight: "2px solid var(--color-divider)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "11px 20px",
              borderBottom: "1px solid var(--color-neutral-300)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Live transcript
            </span>
            <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 20, flex: 1 }}>
              {wave.map((w, i) => (
                <i key={i} style={{ display: "block", flex: 1, background: w.color, height: w.h }} />
              ))}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Sentiment</span>
            <Bar
              width={`${Math.round(((call.sentiment ?? 0) + 1) * 50)}%`}
              color={(call.sentiment ?? 0) < 0 ? "var(--color-accent)" : "var(--color-neutral-700)"}
              style={{ width: 84 }}
            />
            <b
              style={{
                fontSize: 11.5,
                color: (call.sentiment ?? 0) < 0 ? "var(--color-accent-700)" : "var(--color-neutral-800)",
              }}
            >
              {call.sentiment === null ? "—" : call.sentiment.toFixed(2)}
            </b>
          </div>

          <div
            style={{
              flex: 1,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 15,
            }}
          >
            {transcript.map((t) => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 14 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: t.isAi ? "var(--color-accent-700)" : "var(--color-neutral-500)",
                    paddingTop: 2,
                  }}
                >
                  {t.label}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{t.body}</div>
                  {t.citations.length > 0 && (
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          background: "var(--color-accent-200)",
                          color: "var(--color-accent-800)",
                          padding: "4px 8px",
                        }}
                      >
                        {t.citations[0].cite}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          background: "var(--color-neutral-200)",
                          color: "var(--color-neutral-800)",
                          padding: "4px 8px",
                        }}
                      >
                        {t.citations[0].check}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {call.handoff && (
            <div
              style={{
                border: "2px solid var(--color-accent)",
                background: "var(--color-accent-100)",
                padding: "13px 15px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  Guardrail stop
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-accent-800)" }}>
                  Trigger · {call.handoff?.reason}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.5 }}>
                The AI has stopped negotiating and is holding the customer with a status update. A
                brief is written and waiting in the handoff queue.
              </div>
              <div style={{ marginTop: 11, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="hov-accent"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: "var(--color-accent)",
                    color: "var(--color-bg)",
                    padding: "9px 13px",
                  }}
                >
                  Take the line now
                </button>
                <Link
                  href="/app/handoffs"
                  className="hov-invert"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    border: "1px solid var(--color-text)",
                    padding: "8px 13px",
                    color: "var(--color-text)",
                  }}
                >
                  Read the brief
                </Link>
                <button
                  type="button"
                  className="hov-invert"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    border: "1px solid var(--color-text)",
                    padding: "8px 13px",
                  }}
                >
                  Approve the decision
                </button>
              </div>
            </div>
            )}
          </div>

          <div
            style={{
              borderTop: "2px solid var(--color-divider)",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Whisper
            </span>
            <input
              aria-label="Whisper to the AI"
              placeholder="Tell the AI something the customer shouldn't hear…"
              style={{
                flex: 1,
                border: "1px solid var(--color-neutral-400)",
                background: "var(--color-surface)",
                padding: "9px 11px",
                fontSize: 12.5,
                font: "inherit",
                fontFamily: "var(--font-body)",
                color: "var(--color-text)",
                borderRadius: 0,
              }}
            />
            <button
              type="button"
              className="hov-invert"
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                border: "2px solid var(--color-text)",
                padding: "7px 13px",
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* Documents and actions */}
        <div>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Documents in play</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}
            >
              {documentsInPlay.map((d) => (
                <div
                  key={d.title}
                  style={{
                    border: "1px solid var(--color-neutral-400)",
                    background: "var(--color-surface)",
                    padding: "9px 10px",
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b style={{ flex: 1 }}>{d.title}</b>
                    <span
                      style={{
                        color: d.strong ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                        fontWeight: 700,
                      }}
                    >
                      {d.confidence}
                    </span>
                  </div>
                  <div style={{ color: "var(--color-neutral-700)", marginTop: 3 }}>{d.note}</div>
                </div>
              ))}
              <div
                style={{
                  border: "1px dashed var(--color-neutral-400)",
                  padding: "9px 10px",
                  color: "var(--color-neutral-700)",
                }}
              >
                No document covers <b style={{ color: "var(--color-text)" }}>part-delivery refunds</b>{" "}
                — 14th time this month.{" "}
                <LinkAction href="/app/knowledge" size={12}>
                  Draft one
                </LinkAction>
              </div>
            </div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Actions taken this call</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}
            >
              {callActions.map((a) => (
                <div key={`${a.at}-${a.label}`} style={{ display: "flex", gap: 8 }}>
                  <b style={{ color: "var(--color-neutral-700)", width: 40 }}>{a.at}</b>
                  <span style={{ flex: 1, color: a.allowed ? undefined : "var(--color-accent-700)" }}>
                    {a.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px" }}>
            <Kicker>Sentiment across the call</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                height: 62,
                borderBottom: "1px solid var(--color-neutral-400)",
              }}
            >
              {sentCurve.map((p, i) => (
                <span key={i} style={{ flex: 1, display: "block", background: p.color, height: p.h }} />
              ))}
            </div>
            <div
              style={{
                marginTop: 7,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--color-neutral-700)",
              }}
            >
              <span>00:00</span>
              <span>Goodwill offered</span>
              <span>04:12</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
