import { Kicker, LinkAction, OutlineButton, PrimaryButton, ScreenTitle, Tag } from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import {
  conversationStats,
  getConversation,
  listConversations,
  channelLabel,
  clock,
  outcomeLabel,
} from "@/lib/queries/conversations";

const ACTIVE_FILTERS = ["Unresolved by AI", "Last 30 days"];
const FILTER_OPTIONS = [
  "Phone",
  "WhatsApp",
  "Email",
  "Negative sentiment",
  "No citation found",
  "+ Intent",
];

/** A tracked-out uppercase speaker label in a transcript. */
function Speaker({ label, ai }: { label: string; ai: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: ai ? "var(--color-accent-700)" : "var(--color-neutral-500)",
      }}
    >
      {label}
    </span>
  );
}

/** A provenance chip under an AI turn. */
function Provenance({ children, accent = false }: { children: string; accent?: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: accent ? "var(--color-accent-200)" : "var(--color-neutral-200)",
        color: accent ? "var(--color-accent-800)" : "var(--color-neutral-800)",
        padding: "4px 8px",
      }}
    >
      {children}
    </span>
  );
}

const TURN_GRID = { display: "grid", gridTemplateColumns: "96px 1fr", gap: 14 } as const;

export default async function ConversationsPage() {
  const { brand } = await getConsoleContext();
  const [convos, stats] = await Promise.all([
    listConversations(brand.id),
    conversationStats(brand.id),
  ]);

  if (convos.length === 0) {
    return (
      <section style={{ padding: "20px 24px" }}>
        <ScreenTitle kicker="Nothing recorded yet" title="Conversations" />
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "52ch" }}>
          Every contact on every channel lands here with the documents each answer came from. Nothing
          has been recorded for {brand.name} yet.
        </p>
      </section>
    );
  }

  // The archive opens on the most recent conversation with something to learn
  // from — an escalation or a missing document — falling back to the newest.
  const focus = convos.find((c) => c.bad) ?? convos[0];
  const detail = await getConversation(brand.id, focus.id);

  return (
    <section>
      <div style={{ padding: "20px 24px 0", display: "flex", alignItems: "flex-end", gap: 24 }}>
        <ScreenTitle
          kicker={`${stats.total} conversation${stats.total === 1 ? "" : "s"} · retained 2 years`}
          title="Conversations"
        />
        <p
          style={{
            margin: "0 0 3px",
            fontSize: 12.5,
            color: "var(--color-neutral-800)",
            maxWidth: "44ch",
          }}
        >
          Everything the AI and your team ever said, with the documents each answer came from.
        </p>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <OutlineButton>Export for tuning</OutlineButton>
          <PrimaryButton>Review queue · {stats.unresolved}</PrimaryButton>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          marginTop: 16,
          padding: "10px 24px",
          borderTop: "2px solid var(--color-divider)",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          background: "var(--color-surface)",
        }}
      >
        {ACTIVE_FILTERS.map((f) => (
          <span
            key={f}
            style={{
              fontSize: 11,
              fontWeight: 700,
              background: "var(--color-text)",
              color: "var(--color-bg)",
              padding: "5px 9px",
            }}
          >
            {f} ×
          </span>
        ))}
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f}
            type="button"
            className="hov-border"
            style={{
              fontSize: 11,
              fontWeight: 600,
              border: "1px solid var(--color-neutral-400)",
              padding: "4px 9px",
              color: "var(--color-neutral-700)",
            }}
          >
            {f}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          {convos.length} results
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "372px 1fr" }}>
        {/* List */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {convos.map((c) => (
            <button
              key={c.id}
              type="button"
              className="hov-raise"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 18px",
                borderBottom: "1px solid var(--color-neutral-300)",
                borderLeft: `3px solid ${c.edge}`,
                background: c.id === focus.id ? "var(--color-surface)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ fontSize: 12.5 }}>{c.name}</b>
                <span
                  style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--color-neutral-700)" }}
                >
                  {c.when}
                </span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--color-neutral-800)" }}>
                {c.intent}
              </div>
              <div style={{ marginTop: 7, display: "flex", gap: 7, alignItems: "center" }}>
                <Tag bg={c.tagBg} fg={c.tagFg} size={9.5} padding="3px 6px">
                  {c.outcome}
                </Tag>
                <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                  {c.channel} · {c.duration}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: c.sentColor,
                  }}
                >
                  {c.sentiment}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div>
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "2px solid var(--color-divider)",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <Kicker>
                  {detail!.conversation.startedAt.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  ·{" "}
                  {detail!.conversation.startedAt.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {channelLabel(detail!.conversation.channel)} ·{" "}
                  {clock(detail!.conversation.durationSeconds)}
                </Kicker>
                <h2
                  style={{
                    margin: "8px 0 0",
                    fontWeight: 800,
                    fontSize: 21,
                    letterSpacing: "-0.022em",
                  }}
                >
                  {detail!.conversation.intent ?? "Conversation"}
                </h2>
                <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--color-neutral-800)" }}>
                  {detail!.customer && (
                    <LinkAction href={`/app/customers/${detail!.customer.id}`} size={12.5}>
                      {detail!.customer.name}
                    </LinkAction>
                  )}{" "}
                  ·{" "}
                  {detail!.conversation.handledBy
                    ? `AI, then ${detail!.conversation.handledBy}`
                    : "AI only"}{" "}
                  · {outcomeLabel(detail!.conversation.outcome, detail!.conversation.status).toLowerCase()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <OutlineButton style={{ fontSize: 11.5, padding: "8px 12px" }}>
                  Add to tuning set
                </OutlineButton>
                <OutlineButton style={{ fontSize: 11.5, padding: "8px 12px" }}>
                  Flag for review
                </OutlineButton>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                borderTop: "1px solid var(--color-neutral-400)",
                paddingTop: 12,
              }}
            >
              {[
                {
                  label: "Outcome",
                  value: outcomeLabel(detail!.conversation.outcome, detail!.conversation.status),
                  hot: false,
                },
                {
                  label: "Why AI stopped",
                  value:
                    detail!.conversation.outcome === "no_document"
                      ? "No matching document"
                      : detail!.conversation.outcome === "escalated"
                        ? "Beyond its authority"
                        : "It didn't — it finished",
                  hot: detail!.conversation.contained === false,
                },
                {
                  label: "Sentiment",
                  value:
                    detail!.conversation.sentimentStart !== null &&
                    detail!.conversation.sentimentEnd !== null
                      ? `${detail!.conversation.sentimentStart.toFixed(2)} → ${detail!.conversation.sentimentEnd.toFixed(2)}`
                      : (detail!.conversation.sentimentEnd?.toFixed(2) ?? "—"),
                  hot: false,
                },
                {
                  label: "Quality review",
                  value: detail!.conversation.reviewScore
                    ? `${detail!.conversation.reviewScore} / 5 · ${detail!.conversation.reviewerName ?? ""}`
                    : "Not reviewed",
                  hot: false,
                },
              ].map((s) => (
                <div key={s.label}>
                  <Kicker size={9.5} style={{ letterSpacing: "0.12em" }}>
                    {s.label}
                  </Kicker>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      fontWeight: 700,
                      color: s.hot ? "var(--color-accent-700)" : undefined,
                    }}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Transcript */}
          <div
            style={{
              padding: "18px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              maxWidth: 940,
            }}
          >
            {detail!.turns.map((t) => (
              <div
                key={t.id}
                style={
                  t.speaker === "human"
                    ? { borderTop: "2px solid var(--color-divider)", paddingTop: 14, ...TURN_GRID }
                    : TURN_GRID
                }
              >
                {t.speaker === "human" ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--color-neutral-700)",
                    }}
                  >
                    {t.label}
                  </span>
                ) : (
                  <Speaker label={t.label} ai={t.speaker === "ai"} />
                )}
                <div>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {t.authorName ? `${t.authorName}: ` : ""}
                    {t.body}
                  </span>
                  {t.provenance.length > 0 && (
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {t.provenance.map((pv, i) => (
                        <span key={i} style={{ display: "contents" }}>
                          {pv.cite && <Provenance accent>{pv.cite}</Provenance>}
                          {pv.check && <Provenance>{pv.check}</Provenance>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div
              style={{
                marginTop: 4,
                padding: "14px 16px",
                background: "var(--color-surface)",
                borderLeft: "3px solid var(--color-accent)",
              }}
            >
              <Kicker color="var(--color-accent-700)" style={{ letterSpacing: "0.12em" }}>
                What this conversation changed
              </Kicker>
              <div
                style={{
                  marginTop: 9,
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  fontSize: 12.5,
                  color: "var(--color-neutral-800)",
                }}
              >
                {detail!.conversation.outcome === "no_document" && (
                  <div>
                    Logged as a documentation gap ·{" "}
                    <LinkAction href="/app/knowledge" size={12.5}>
                      review the gaps
                    </LinkAction>
                  </div>
                )}
                {detail!.conversation.contained === false && (
                  <div>Counted against containment on the Analytics screen</div>
                )}
                {detail!.conversation.sentimentStart !== null &&
                  detail!.conversation.sentimentEnd !== null && (
                    <div>
                      Sentiment moved {detail!.conversation.sentimentStart.toFixed(2)} →{" "}
                      {detail!.conversation.sentimentEnd.toFixed(2)}
                    </div>
                  )}
                <div>Every turn above is stored with the document it came from</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
