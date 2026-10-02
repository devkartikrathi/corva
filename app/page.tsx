import Link from "next/link";
import { INDUSTRIES } from "@/lib/business/industries";
import type { CSSProperties, ReactNode } from "react";
import {
  industryNotes,
  footerColumns,
  heroStats,
  heroWave,
  knownFacts,
  logos,
  loopSteps,
  nextActions,
  connectWays,
  planNotes,
  plans,
  platformCards,
} from "@/lib/marketing";

/* ─── Local primitives ─────────────────────────────────────────────────── */

const SHELL: CSSProperties = { maxWidth: 1440, margin: "0 auto", padding: "0 48px" };

/** The tracked-out uppercase eyebrow above every section heading. */
function Eyebrow({ children, color = "var(--color-neutral-700)" }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

/** A 38px section heading. */
function SectionHeading({ children, maxWidth }: { children: ReactNode; maxWidth?: string }) {
  return (
    <h2
      style={{
        margin: "12px 0 0",
        fontWeight: 800,
        fontSize: 38,
        lineHeight: 1.02,
        letterSpacing: "-0.028em",
        maxWidth,
      }}
    >
      {children}
    </h2>
  );
}

/** Solid accent call to action. */
function AccentLink({
  href,
  children,
  arrow,
  minWidth,
  style,
}: {
  href: string;
  children: ReactNode;
  arrow?: boolean;
  minWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <Link
      href={href}
      className="hov-accent"
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: "var(--color-bg)",
        background: "var(--color-accent)",
        padding: "15px 22px",
        minWidth,
        display: arrow ? "flex" : "inline-block",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        ...style,
      }}
    >
      {arrow ? (
        <>
          <span>{children}</span>
          <span aria-hidden="true">→</span>
        </>
      ) : (
        children
      )}
    </Link>
  );
}

/** Ink-outlined link that inverts on hover. */
function OutlineLink({ href, children, style }: { href: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <Link
      href={href}
      className="hov-invert"
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: "var(--color-text)",
        border: "2px solid var(--color-text)",
        padding: "13px 22px",
        display: "inline-block",
        ...style,
      }}
    >
      {children}
    </Link>
  );
}

const CHIP: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "4px 8px",
};

/** The small uppercase plan name above each pricing column. */
const planLabel = (color: string): CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color,
});

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", fontSize: 15, lineHeight: 1.5 }}>
      {/* ── Header ── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "var(--color-bg)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        <div style={{ ...SHELL, height: 68, display: "flex", alignItems: "center", gap: 48 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>CORVA</span>
            <span style={{ width: 8, height: 8, background: "var(--color-accent)", display: "block" }} />
          </div>
          <nav
            style={{
              display: "flex",
              gap: 28,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-neutral-700)",
            }}
          >
            {[
              ["#platform", "Platform"],
              ["#loop", "How it works"],
              ["#connect", "Connect"],
              ["#signals", "Industries"],
              ["#pricing", "Pricing"],
              ["/developers", "Developers"],
            ].map(([href, label]) => (
              <a key={label} href={href} className="hov-ink" style={{ color: "var(--color-neutral-700)" }}>
                {label}
              </a>
            ))}
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              href="/app"
              className="hov-ink"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px" }}
            >
              Sign in
            </Link>
            <Link
              href="/demo"
              className="hov-invert"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", border: "2px solid var(--color-text)", padding: "9px 16px" }}
            >
              Book a demo
            </Link>
            <Link
              href="/sign-up"
              className="hov-accent"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-bg)",
                background: "var(--color-accent)",
                padding: "11px 18px",
              }}
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={{ borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ ...SHELL, display: "grid", gridTemplateColumns: "1.55fr 1fr" }}>
          <div style={{ padding: "88px 64px 72px 0", borderRight: "2px solid var(--color-divider)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: "var(--color-accent)",
                  display: "block",
                  animation: "cv-pulse 2.4s ease-in-out infinite",
                }}
              />
              AI front office for Indian businesses
            </div>

            <h1
              style={{
                margin: "28px 0 0",
                fontWeight: 800,
                fontSize: 76,
                lineHeight: 0.94,
                letterSpacing: "-0.035em",
                maxWidth: "15ch",
              }}
            >
              Every customer answered. Every lead followed up.
            </h1>

            <p
              style={{
                margin: "28px 0 0",
                fontSize: 19,
                lineHeight: 1.45,
                color: "var(--color-neutral-800)",
                maxWidth: "52ch",
                textWrap: "pretty",
              }}
            >
              Corva puts an AI that knows your business on your website&rsquo;s chat and on voice calls
              started from your site, around the clock. Every conversation becomes a customer record,
              anyone who wants something becomes a lead with an owner, and every promised callback has
              a name and a time on it — with your team one click from taking over.
            </p>

            <div style={{ marginTop: 36, display: "flex", gap: 10 }}>
              <AccentLink href="/sign-up" arrow minWidth={220}>
                Start free for 14 days
              </AccentLink>
              <OutlineLink href="/demo">Book a demo</OutlineLink>
            </div>

            <div
              style={{
                marginTop: 56,
                display: "flex",
                alignItems: "center",
                gap: 24,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-500)",
              }}
            >
              <span>Built for</span>
              <span style={{ height: 1, flex: 1, background: "var(--color-neutral-300)" }} />
              {logos.map((l) => (
                <span key={l} style={{ color: "var(--color-neutral-700)" }}>
                  {l}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateRows: "repeat(4, 1fr)" }}>
            {heroStats.map((s, i) => (
              <div
                key={s.label}
                style={{
                  padding: "28px 0 24px 32px",
                  borderBottom: i < heroStats.length - 1 ? "2px solid var(--color-divider)" : undefined,
                }}
              >
                <Eyebrow>{s.label}</Eyebrow>
                <div
                  style={{
                    marginTop: 10,
                    fontWeight: 800,
                    fontSize: 46,
                    lineHeight: 1,
                    letterSpacing: "-0.03em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.value}
                  {"suffix" in s && s.suffix && (
                    <span
                      style={
                        s.suffixAccent
                          ? { color: "var(--color-accent)" }
                          : { fontSize: 22, color: "var(--color-neutral-700)" }
                      }
                    >
                      {s.suffix}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Console mock ── */}
      <section
        id="platform"
        style={{ borderBottom: "2px solid var(--color-divider)", background: "var(--color-surface)" }}
      >
        <div style={{ ...SHELL, padding: "56px 48px 64px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 48,
              paddingBottom: 24,
              borderBottom: "2px solid var(--color-divider)",
            }}
          >
            <div>
              <Eyebrow>Live console</Eyebrow>
              <SectionHeading maxWidth="22ch">The AI works in the open.</SectionHeading>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 15,
                color: "var(--color-neutral-800)",
                maxWidth: "44ch",
                textWrap: "pretty",
              }}
            >
              Every chat and call streams as text, every answer cites the document it came from, the
              details you asked for fill in as they are said, and anyone on your team can take the
              line mid-sentence.
            </p>
          </div>

          <div
            style={{
              marginTop: 32,
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              boxShadow: "0 12px 32px rgba(45,43,43,0.22)",
            }}
          >
            {/* Call bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "12px 18px",
                borderBottom: "2px solid var(--color-divider)",
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
                <span
                  style={{
                    width: 7,
                    height: 7,
                    background: "var(--color-accent)",
                    display: "block",
                    animation: "cv-pulse 1.6s ease-in-out infinite",
                  }}
                />
                On call · 04:12
              </span>
              <span style={{ height: 20, width: 2, background: "var(--color-neutral-300)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Marguerite Okonkwo</span>
              <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
                +91 98200 41187 · Aurelius Home · Tier 1
              </span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    background: "var(--color-accent)",
                    color: "var(--color-bg)",
                    padding: "5px 9px",
                  }}
                >
                  Priority 92
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    border: "2px solid var(--color-text)",
                    padding: "3px 9px",
                  }}
                >
                  Churn risk high
                </span>
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px" }}>
              <div style={{ borderRight: "2px solid var(--color-divider)" }}>
                {/* Waveform */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--color-neutral-300)",
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
                    Waveform
                  </span>
                  <span style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 26, flex: 1 }}>
                    {heroWave.map((h, i) => (
                      <i
                        key={i}
                        style={{
                          display: "block",
                          width: 3,
                          height: `${h}%`,
                          background: h >= 85 ? "var(--color-accent)" : "var(--color-neutral-400)",
                        }}
                      />
                    ))}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-neutral-700)" }}>
                    Sentiment
                  </span>
                  <span
                    style={{
                      width: 120,
                      height: 6,
                      background: "var(--color-neutral-300)",
                      display: "block",
                    }}
                  >
                    <span style={{ display: "block", width: "34%", height: "100%", background: "var(--color-accent)" }} />
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--color-accent-700)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    −0.32
                  </span>
                </div>

                {/* Transcript */}
                <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 14 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--color-neutral-500)",
                        paddingTop: 2,
                      }}
                    >
                      04:02 · Cust
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--color-text)" }}>
                      This is the third time the delivery slot has moved. I&rsquo;ve taken a day off work
                      for this.
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 14 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--color-accent-700)",
                        paddingTop: 2,
                      }}
                    >
                      04:06 · AI
                    </div>
                    <div>
                      <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                        You&rsquo;ve had three reschedules on order AH-40912, so this qualifies for the
                        goodwill credit under your service promise. I can apply ₹4,000 now and book a fixed
                        morning slot for Thursday.
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span
                          style={{
                            ...CHIP,
                            background: "var(--color-accent-200)",
                            color: "var(--color-accent-800)",
                          }}
                        >
                          Cited · Service promise v4 §3.2
                        </span>
                        <span
                          style={{
                            ...CHIP,
                            background: "var(--color-neutral-200)",
                            color: "var(--color-neutral-800)",
                          }}
                        >
                          Goodwill ceiling ₹5,000 · within policy
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: 14 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--color-neutral-500)",
                        paddingTop: 2,
                      }}
                    >
                      04:11 · Cust
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                      And I want the installation fee waived. Otherwise I&rsquo;m cancelling the whole
                      contract.
                    </div>
                  </div>

                  <div
                    style={{
                      border: "2px solid var(--color-accent)",
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      background: "var(--color-accent-100)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--color-accent-700)",
                      }}
                    >
                      Escalation trigger
                    </span>
                    <span style={{ fontSize: 13, color: "var(--color-text)", flex: 1 }}>
                      Cancellation intent + request beyond AI authority. Routing to a human with brief.
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        background: "var(--color-accent)",
                        color: "var(--color-bg)",
                        padding: "8px 12px",
                      }}
                    >
                      Take the line
                    </span>
                  </div>
                </div>
              </div>

              {/* Mock rail */}
              <aside style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--color-neutral-700)",
                      paddingBottom: 8,
                      borderBottom: "2px solid var(--color-divider)",
                    }}
                  >
                    What the AI knows
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      fontSize: 12.5,
                      color: "var(--color-neutral-800)",
                    }}
                  >
                    {knownFacts.map((f) => (
                      <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span>{f.label}</span>
                        <b
                          style={{
                            color: f.hot ? "var(--color-accent-700)" : "var(--color-text)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {f.value}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--color-neutral-700)",
                      paddingBottom: 8,
                      borderBottom: "2px solid var(--color-divider)",
                    }}
                  >
                    Next best actions
                  </div>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {nextActions.map((a) => (
                      <div
                        key={a.label}
                        style={{
                          border: "1px solid var(--color-neutral-300)",
                          background: "var(--color-surface)",
                          padding: "9px 11px",
                          fontSize: 12.5,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <span>{a.label}</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: a.hot ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                          }}
                        >
                          {a.state}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "auto",
                    borderTop: "2px solid var(--color-divider)",
                    paddingTop: 12,
                    fontSize: 12,
                    color: "var(--color-neutral-700)",
                    lineHeight: 1.4,
                  }}
                >
                  Transcript, citations, sentiment curve and every action taken are written to the
                  customer record when the call ends.
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      {/* ── The loop ── */}
      <section id="loop" style={{ borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ ...SHELL, padding: "56px 48px 0" }}>
          <Eyebrow>The loop</Eyebrow>
          <h2
            style={{
              margin: "12px 0 40px",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1.02,
              letterSpacing: "-0.028em",
              maxWidth: "26ch",
            }}
          >
            Nothing is lost between the conversation and the record.
          </h2>
        </div>
        <div
          style={{
            ...SHELL,
            padding: "0 48px 56px",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderTop: "2px solid var(--color-divider)",
          }}
        >
          {loopSteps.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding:
                  i === 0
                    ? "24px 28px 8px 0"
                    : i === loopSteps.length - 1
                      ? "24px 0 8px 28px"
                      : "24px 28px 8px",
                borderRight: i < loopSteps.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.1em", color: "var(--color-accent)" }}>
                {s.n}
              </div>
              <h3 style={{ margin: "14px 0 8px", fontWeight: 700, fontSize: 19, letterSpacing: "-0.01em" }}>
                {s.title}
              </h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-800)" }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ways to connect ── */}
      <section id="connect" style={{ borderBottom: "2px solid var(--color-divider)", background: "var(--color-surface)" }}>
        <div style={{ ...SHELL, padding: "56px 48px 64px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 48 }}>
            <div>
              <Eyebrow>Connect</Eyebrow>
              <SectionHeading maxWidth="24ch">Three ways in. One assistant, one console.</SectionHeading>
            </div>
            <p style={{ margin: 0, fontSize: 15, color: "var(--color-neutral-800)", maxWidth: "44ch", textWrap: "pretty" }}>
              However a customer reaches you, it is the same assistant with the same knowledge, and
              the conversation lands in the same place for your team.
            </p>
          </div>
          <div
            style={{
              marginTop: 32,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              borderTop: "2px solid var(--color-divider)",
            }}
          >
            {connectWays.map((w, i) => (
              <div
                key={w.n}
                style={{
                  padding: i === 0 ? "24px 28px 0 0" : i === connectWays.length - 1 ? "24px 0 0 28px" : "24px 28px 0",
                  borderRight: i < connectWays.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13, color: "var(--color-accent-700)", letterSpacing: "0.08em" }}>{w.n}</div>
                <h3 style={{ margin: "10px 0 0", fontWeight: 800, fontSize: 20, letterSpacing: "-0.015em" }}>{w.title}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-800)", textWrap: "pretty" }}>
                  {w.body}
                </p>
                {w.link && (
                  <Link
                    href={w.link.href}
                    className="hov-ink"
                    style={{ display: "inline-block", marginTop: 14, fontSize: 13, fontWeight: 700, color: "var(--color-accent-700)" }}
                  >
                    {w.link.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Signals (dark) ── */}
      <section
        id="signals"
        style={{
          borderBottom: "2px solid var(--color-divider)",
          background: "var(--color-text)",
          color: "var(--color-bg)",
        }}
      >
        <div
          style={{
            ...SHELL,
            padding: "56px 48px 64px",
            display: "grid",
            gridTemplateColumns: "1fr 1.35fr",
            gap: 64,
          }}
        >
          <div>
            <Eyebrow color="var(--color-neutral-500)">Industries</Eyebrow>
            <SectionHeading>It already knows the job.</SectionHeading>
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 15,
                lineHeight: 1.55,
                color: "var(--color-neutral-300)",
                textWrap: "pretty",
              }}
            >
              A clinic, an estate agent and a laundry do not want the same things from a customer.
              Each starts from a template that knows what to ask, what can be booked, what it may do on
              its own, and what its pipeline is called.
            </p>
            <div
              style={{
                marginTop: 28,
                borderTop: "2px solid var(--color-neutral-800)",
                paddingTop: 18,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                fontSize: 13,
                color: "var(--color-neutral-400)",
              }}
            >
              {industryNotes.map((n) => (
                <div key={n} style={{ display: "flex", gap: 12 }}>
                  <span style={{ color: "var(--color-accent-500)", fontWeight: 700 }}>→</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0 40px",
              alignContent: "start",
            }}
          >
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-600)",
                paddingBottom: 10,
                borderBottom: "2px solid var(--color-neutral-800)",
              }}
            >
              <span>Industry</span>
              <span>Pipeline</span>
            </div>

            {INDUSTRIES.filter((ind) => ind.key !== "general").map((ind) => (
              <div
                key={ind.key}
                style={{
                  gridColumn: "1 / -1",
                  padding: "13px 0",
                  borderBottom: "1px solid var(--color-neutral-800)",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 14,
                }}
              >
                <span style={{ fontSize: 13.5, width: 190 }}>{ind.label}</span>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--color-neutral-400)" }}>
                  {ind.stages.new} → {ind.stages.qualified} →{" "}
                  <b style={{ color: "var(--color-accent-500)" }}>{ind.stages.won}</b>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform grid ── */}
      <section style={{ borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ ...SHELL, padding: "56px 48px 0" }}>
          <Eyebrow>Platform</Eyebrow>
          <h2
            style={{
              margin: "12px 0 36px",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1.02,
              letterSpacing: "-0.028em",
              maxWidth: "28ch",
            }}
          >
            One place for anything customer-related.
          </h2>
        </div>
        <div
          style={{
            ...SHELL,
            padding: "0 48px 56px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            borderTop: "2px solid var(--color-divider)",
          }}
        >
          {platformCards.map((c, i) => {
            const col = i % 3;
            const lastRow = i >= platformCards.length - 3;
            return (
              <div
                key={c.title}
                style={{
                  padding:
                    col === 0
                      ? `26px 28px ${lastRow ? "0" : "26px"} 0`
                      : col === 2
                        ? `26px 0 ${lastRow ? "0" : "26px"} 28px`
                        : `26px 28px ${lastRow ? "0" : "26px"}`,
                  borderRight: col < 2 ? "1px solid var(--color-neutral-300)" : undefined,
                  borderBottom: lastRow ? undefined : "1px solid var(--color-neutral-300)",
                }}
              >
                <h3 style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 17 }}>{c.title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--color-neutral-800)" }}>
                  {c.body}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section
        id="pricing"
        style={{ borderBottom: "2px solid var(--color-divider)", background: "var(--color-surface)" }}
      >
        <div style={{ ...SHELL, padding: "56px 48px 64px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 48 }}>
            <div>
              <Eyebrow>Pricing</Eyebrow>
              <SectionHeading>A monthly plan, with usage included.</SectionHeading>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: "var(--color-neutral-700)", maxWidth: "40ch" }}>
              A bill you can predict: the assistant, the customer records and your team&rsquo;s
              follow-ups in one price, with chats and voice minutes included.
            </p>
          </div>

          <div
            style={{
              marginTop: 32,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              borderTop: "2px solid var(--color-divider)",
            }}
          >
            {plans.map((p, i) => (
              <div
                key={p.name}
                style={
                  p.featured
                    ? {
                        padding: 28,
                        borderRight: "1px solid var(--color-neutral-300)",
                        background: "var(--color-bg)",
                        borderTop: "4px solid var(--color-accent)",
                        marginTop: -2,
                      }
                    : {
                        padding: i === 0 ? "28px 28px 28px 0" : "28px 0 28px 28px",
                        borderRight: i === 0 ? "1px solid var(--color-neutral-300)" : undefined,
                      }
                }
              >
                {p.featured ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={planLabel("var(--color-accent-700)")}>{p.name}</div>
                    <div
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
                      {p.badge}
                    </div>
                  </div>
                ) : (
                  <div style={planLabel("var(--color-neutral-700)")}>{p.name}</div>
                )}

                <div
                  style={{
                    marginTop: 14,
                    fontWeight: 800,
                    fontSize: 42,
                    letterSpacing: "-0.03em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.price}
                  {p.unit && (
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-neutral-700)" }}>
                      {p.unit}
                    </span>
                  )}
                </div>

                <p style={{ margin: "12px 0 20px", fontSize: 13.5, color: "var(--color-neutral-800)" }}>
                  {p.blurb}
                </p>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    fontSize: 13,
                    color: "var(--color-neutral-800)",
                    borderTop: "1px solid var(--color-neutral-300)",
                    paddingTop: 14,
                  }}
                >
                  {p.features.map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>

                {p.featured ? (
                  <Link
                    href={p.href}
                    className="hov-accent"
                    style={{
                      marginTop: 22,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-bg)",
                      background: "var(--color-accent)",
                      padding: "14px 18px",
                      display: "block",
                    }}
                  >
                    {p.cta}
                  </Link>
                ) : (
                  <Link
                    href={p.href}
                    className="hov-invert"
                    style={{
                      marginTop: 22,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      border: "2px solid var(--color-text)",
                      padding: "12px 18px",
                      display: "block",
                    }}
                  >
                    {p.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 20,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 12.5,
              color: "var(--color-neutral-700)",
            }}
          >
            {planNotes.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}>
        <div style={{ ...SHELL, padding: "72px 48px" }}>
          <h2
            style={{
              margin: 0,
              fontWeight: 800,
              fontSize: 68,
              lineHeight: 0.96,
              letterSpacing: "-0.035em",
              maxWidth: "20ch",
            }}
          >
            Your customers are already telling you everything.
          </h2>
          <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href="/demo"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--color-accent)",
                background: "var(--color-bg)",
                padding: "15px 22px",
                minWidth: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <span>Book a demo</span>
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/sign-up"
              className="hov-invert-light"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--color-bg)",
                border: "2px solid var(--color-bg)",
                padding: "13px 22px",
              }}
            >
              Start free for 14 days
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: "var(--color-text)", color: "var(--color-neutral-500)" }}>
        <div style={{ ...SHELL, padding: "40px 48px", display: "flex", gap: 48, alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, color: "var(--color-bg)" }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>CORVA</span>
            <span style={{ width: 7, height: 7, background: "var(--color-accent)", display: "block" }} />
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(120px, auto))",
              gap: 32,
              fontSize: 12.5,
            }}
          >
            {footerColumns.map((col) => (
              <div key={col.title} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <span
                  style={{
                    color: "var(--color-neutral-700)",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {col.title}
                </span>
                {col.links.map((l) => (
                  <a key={l.label} href={l.href} className="hov-light" style={{ color: "var(--color-neutral-500)" }}>
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...SHELL, padding: "0 48px 32px", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          © 2026 Tiruvi · Corva is a Tiruvi product
        </div>
      </footer>
    </div>
  );
}
