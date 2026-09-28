import Link from "next/link";
import { redirect } from "next/navigation";
import { Bar, Kicker, LinkAction, LiveDot, OutlineButton, PrimaryButton, ScreenTitle, SectionTitle } from "@/components/ui";
import { FollowUpButtons } from "@/components/CrmControls";
import { ActionButton } from "@/components/ActionButton";
import { LiveRefresh } from "@/components/LiveRefresh";
import { takeOverCall } from "@/lib/actions/conversations";
import { getConsoleContext } from "@/lib/auth/context";
import { customerScope } from "@/lib/auth/scope";
import { completeFollowUp, postponeFollowUp, reopenFollowUp } from "@/lib/actions/crm";
import { industryFor } from "@/lib/business/industries";
import { formatRupeesShort } from "@/lib/money";
import { docGaps, headlineStats, liveCalls, needsHuman } from "@/lib/queries/command";
import { crmSnapshot, listFollowUps, listLeads } from "@/lib/queries/crm";

export default async function HomePage() {
  const { session, brand } = await getConsoleContext();

  /**
   * An Agent's landing screen is their own book.
   *
   * The brand-wide panels below stay — containment and the day's volume are
   * context everyone benefits from, and hiding them would leave an Agent
   * unable to tell a quiet morning from a broken helpline. What changes is the
   * queue: "who needs me next" is a different list depending on who is asking,
   * and showing an Agent the whole brand's priority order is showing them
   * mostly other people's accounts.
   */
  const scope = customerScope(session.actor, session.membershipId, brand.id);
  const mine = scope.kind === "own";

  const [stats, live, waiting, gaps, crm, dueFollowUps, overdueFollowUps, leads] = await Promise.all([
    headlineStats(brand.id),
    liveCalls(brand.id),
    needsHuman(brand.id),
    docGaps(brand.id),
    crmSnapshot(brand.id, scope),
    listFollowUps(brand.id, scope, { window: "today", limit: 8 }),
    listFollowUps(brand.id, scope, { window: "overdue", limit: 8 }),
    listLeads(brand.id, scope),
  ]);
  const industry = industryFor(brand.industry);
  const followUps = [...overdueFollowUps, ...dueFollowUps].slice(0, 8);
  const newestLeads = leads.filter((l) => l.stage !== "won" && l.stage !== "lost").slice(0, 6);

  // The business's numbers first — leads and promises — then the AI's.
  const pick = (label: string) => stats.find((s) => s.label.startsWith(label));
  const headline = [
    {
      label: "New leads · 7 days",
      value: String(crm.newLeadsThisWeek),
      note: crm.leadsByAiThisWeek ? `${crm.leadsByAiThisWeek} captured by the AI on calls` : "none captured yet",
      accent: false,
      href: "/app/leads",
    },
    {
      label: "Open pipeline",
      value: String(crm.openLeads),
      note: crm.pipelinePaise ? `worth ${formatRupeesShort(crm.pipelinePaise)}` : `${crm.wonThisWeek} ${industry.stages.won.toLowerCase()} this week`,
      accent: false,
      href: "/app/leads",
    },
    {
      label: "Follow-ups still due today",
      value: String(crm.followUps.today),
      note: crm.followUps.overdue ? `${crm.followUps.overdue} overdue` : "nothing overdue",
      accent: crm.followUps.overdue > 0,
      href: "/app/follow-ups",
    },
    ...[pick("Contacts"), pick("AI containment"), pick("Waiting")]
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({ label: s.label, value: `${s.value}${s.unit ?? ""}`, note: s.note, accent: Boolean(s.accent), href: undefined as string | undefined })),
  ];

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
        <ScreenTitle kicker={mine ? `${brand.name} · your work` : brand.name} title="Today" />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <LiveRefresh active={live.length > 0 || waiting.length > 0} />
          <OutlineButton href="/app/follow-ups">Follow-ups</OutlineButton>
          <PrimaryButton href="/app/leads" style={{ fontWeight: 600 }}>
            {mine ? "My leads →" : "Leads →"}
          </PrimaryButton>
        </div>
      </div>

      {/* Headline numbers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${headline.length}, 1fr)`,
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        {headline.map((stat, i) => {
          const body = (
            <>
              <Kicker style={{ letterSpacing: "0.12em" }}>{stat.label}</Kicker>
              <div
                style={{
                  marginTop: 8,
                  fontWeight: 800,
                  fontSize: 30,
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  color: stat.accent ? "var(--color-accent-700)" : "var(--color-text)",
                }}
              >
                {stat.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, color: stat.accent ? "var(--color-accent-700)" : "var(--color-neutral-700)" }}>
                {stat.note}
              </div>
            </>
          );
          const style = {
            padding: "16px 20px",
            borderRight: i < headline.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
            display: "block",
          } as const;
          return stat.href ? (
            <Link key={stat.label} href={stat.href} className="hov-surface" style={style}>
              {body}
            </Link>
          ) : (
            <div key={stat.label} style={style}>
              {body}
            </div>
          );
        })}
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
                {c.heldBy ? (
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                    Held by <b style={{ color: "var(--color-text)" }}>{c.heldBy}</b>
                  </span>
                ) : (
                  <ActionButton
                    variant="primary"
                    pendingLabel="Joining…"
                    style={{ fontSize: 11, padding: "7px 10px" }}
                    action={async () => {
                      "use server";
                      await takeOverCall(c.id);
                      // Taking the line means talking on it, and the composer is on the call screen.
                      redirect(`/app/live?call=${c.id}`);
                    }}
                  >
                    Take the line
                  </ActionButton>
                )}
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
          {/* Follow-ups */}
          <div style={{ padding: "16px 24px 10px", display: "flex", alignItems: "baseline", gap: 12 }}>
            <SectionTitle>{mine ? "Your follow-ups" : "Follow-ups due"}</SectionTitle>
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>Overdue first, then today</span>
            <LinkAction href="/app/follow-ups" style={{ marginLeft: "auto" }}>
              All follow-ups →
            </LinkAction>
          </div>
          <div style={{ borderTop: "2px solid var(--color-divider)" }}>
            {followUps.length === 0 && (
              <p style={{ margin: 0, padding: "14px 24px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
                Nothing due today. When the AI promises a caller a callback, it lands here with a name on it.
              </p>
            )}
            {followUps.map((f) => (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "11px 24px",
                  borderBottom: "1px solid var(--color-neutral-300)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{f.title}</b>
                  <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                    {f.customerId ? (
                      <Link href={`/app/customers/${f.customerId}`} style={{ color: "var(--color-text)", fontWeight: 600 }}>
                        {f.customerName ?? f.leadName}
                      </Link>
                    ) : (
                      f.leadName ?? "—"
                    )}
                    {f.customerPhone && ` · ${f.customerPhone}`}
                    {!mine && ` · ${f.assigneeName ?? "unassigned"}`}
                    {f.createdByAi && " · promised by the AI"}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: f.overdue ? "var(--color-accent-700)" : "var(--color-neutral-800)" }}>
                  {f.overdue ? "Overdue · " : ""}
                  {f.dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", ...(f.overdue ? { day: "numeric", month: "short" } : {}) })}
                </span>
                <FollowUpButtons
                  open={f.status === "open"}
                  onDone={async (outcome) => {
                    "use server";
                    await completeFollowUp(f.id, outcome);
                  }}
                  onPostpone={async () => {
                    "use server";
                    await postponeFollowUp(f.id, 1);
                  }}
                  onReopen={async () => {
                    "use server";
                    await reopenFollowUp(f.id);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Newest leads */}
          <div style={{ padding: "18px 24px 10px", display: "flex", alignItems: "baseline", gap: 12, borderTop: "2px solid var(--color-divider)" }}>
            <SectionTitle>{mine ? "Your newest leads" : "Newest leads"}</SectionTitle>
            <LinkAction href="/app/leads" style={{ marginLeft: "auto" }}>
              Pipeline →
            </LinkAction>
          </div>
          <div style={{ borderTop: "2px solid var(--color-divider)" }}>
            {newestLeads.length === 0 && (
              <p style={{ margin: 0, padding: "14px 24px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
                No open leads. New callers who want something become leads here, with an owner.
              </p>
            )}
            {newestLeads.map((l) => (
              <div
                key={l.id}
                style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "11px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {l.customerId ? (
                    <Link href={`/app/customers/${l.customerId}`} style={{ color: "var(--color-text)", fontWeight: 700, fontSize: 13 }}>
                      {l.name}
                    </Link>
                  ) : (
                    <b style={{ fontSize: 13 }}>{l.name}</b>
                  )}
                  {l.createdByAi && (
                    <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "1px 5px" }}>
                      AI
                    </span>
                  )}
                  <div style={{ marginTop: 2, fontSize: 12, color: "var(--color-neutral-800)" }}>{l.interest || "—"}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>{industry.stages[l.stage]}</span>
                <span style={{ width: 120, fontSize: 11.5, color: "var(--color-neutral-700)", textAlign: "right" }}>{l.ownerName ?? "Unassigned"}</span>
              </div>
            ))}
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
            <Kicker>Callers asked, the AI had no answer</Kicker>
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

        </div>
      </div>
    </section>
  );
}
