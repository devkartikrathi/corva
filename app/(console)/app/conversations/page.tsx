import Link from "next/link";
import { Kicker, LinkAction, OutlineButton, PrimaryButton, ScreenTitle, Tag } from "@/components/ui";
import { ActiveFilters, Chip, Pager, SearchBox, Tab, TabStrip } from "@/components/filters";
import { ReviewForm } from "@/components/ReviewForm";
import { formatCost } from "@/lib/pricing";
import { ExportButton } from "@/components/ExportButton";
import { SaveViewButton } from "@/components/SaveViewButton";
import { saveView } from "@/lib/actions/workspace";
import { getConsoleContext } from "@/lib/auth/context";
import { href, intOf, listOf, normalise, type RawParams } from "@/lib/params";
import { exportTranscript, reviewConversation } from "@/lib/actions/conversations";
import {
  archiveFacets,
  conversationStats,
  getConversation,
  listConversations,
  channelLabel,
  clock,
  outcomeLabel,
} from "@/lib/queries/conversations";
import { listSavedViews, matchView } from "@/lib/queries/views";

const PATH = "/app/conversations";
const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
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

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { session, brand } = await getConsoleContext();
  const params = normalise(await searchParams);
  const ctx = { pathname: PATH, params };

  const [result, stats, facets, views] = await Promise.all([
    listConversations(brand.id, {
      q: params.q,
      channel: listOf(params, "channel"),
      outcome: listOf(params, "outcome"),
      status: params.status,
      since: params.since,
      reviewed: params.reviewed === "yes" || params.reviewed === "no" ? params.reviewed : undefined,
      test: params.test === "only" || params.test === "exclude" ? params.test : undefined,
      sort: params.sort,
      page: intOf(params, "page", 1, 1),
    }),
    conversationStats(brand.id),
    archiveFacets(brand.id),
    listSavedViews(session.orgId, "conversations", session.membershipId),
  ]);

  const convos = result.rows;
  const currentView = matchView(views, params);

  if (stats.total === 0) {
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

  // The archive opens on whatever the URL names, then on the most recent
  // conversation with something to learn from — an escalation or a missing
  // document — falling back to the newest on the page.
  const focus =
    convos.find((c) => c.id === params.id) ?? convos.find((c) => c.bad) ?? convos[0] ?? null;
  const detail = focus ? await getConversation(brand.id, focus.id) : null;

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
          <OutlineButton href={href(PATH, params, { reviewed: "no", outcome: null })}>
            Unreviewed
          </OutlineButton>
          <PrimaryButton href={href(PATH, {}, { outcome: "escalated,no_document,detractor" })}>
            Review queue · {stats.unresolved}
          </PrimaryButton>
        </div>
      </div>

      {/* Saved views */}
      <TabStrip style={{ marginTop: 16 }}>
        {views.map((v) => (
          <Tab key={v.id} label={v.name} href={v.href} current={currentView?.id === v.id} />
        ))}
        {!currentView && <Tab label="Custom" href={PATH} current />}
        <SaveViewButton surface="conversations" query={params} onSave={saveView} />
      </TabStrip>

      {/* Filter bar */}
      <div
        style={{
          padding: "10px 24px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          background: "var(--color-surface)",
        }}
      >
        <SearchBox ctx={ctx} placeholder="Search intents and transcripts" width={250} />

        <span style={{ width: 1, height: 18, background: "var(--color-neutral-400)" }} />
        {facets.channels.map((c) => (
          <Chip key={c.key} ctx={ctx} paramKey="channel" value={c.key} label={`${c.label} ${c.count}`} multi />
        ))}

        <span style={{ width: 1, height: 18, background: "var(--color-neutral-400)" }} />
        {facets.outcomes.map((o) => (
          <Chip key={o.key} ctx={ctx} paramKey="outcome" value={o.key} label={`${o.label} ${o.count}`} multi />
        ))}

        <span style={{ width: 1, height: 18, background: "var(--color-neutral-400)" }} />
        <Chip ctx={ctx} paramKey="reviewed" value="no" label={`Unreviewed ${facets.reviewed.no}`} />
        {facets.tests > 0 && (
          <Chip ctx={ctx} paramKey="test" value="only" label={`Tests ${facets.tests}`} />
        )}
        {WINDOWS.map((w) => (
          <Chip key={w.value} ctx={ctx} paramKey="since" value={w.value} label={w.label} />
        ))}

        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <ActiveFilters ctx={ctx} ignore={["page", "sort", "id"]} />
          <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            {result.total} result{result.total === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "372px 1fr" }}>
        {/* List */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {convos.length === 0 && (
            <p style={{ padding: "24px 18px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
              No conversation matches these filters. {stats.total} exist in {brand.name}.
            </p>
          )}
          {convos.map((c) => (
            <Link
              key={c.id}
              href={href(PATH, params, { id: c.id, page: String(result.page) })}
              className="hov-raise"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 18px",
                borderBottom: "1px solid var(--color-neutral-300)",
                borderLeft: `3px solid ${c.edge}`,
                background: c.id === focus?.id ? "var(--color-surface)" : "transparent",
                color: "var(--color-text)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ fontSize: 12.5 }}>{c.name}</b>
                {c.isTest && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      border: "1px solid var(--color-neutral-400)",
                      color: "var(--color-neutral-700)",
                      padding: "1px 4px",
                    }}
                  >
                    TEST
                  </span>
                )}
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
            </Link>
          ))}
          <Pager ctx={ctx} page={result.page} pageSize={result.pageSize} total={result.total} />
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
                {detail!.conversation.summary && (
                  <p
                    style={{
                      margin: "9px 0 0",
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "var(--color-neutral-800)",
                      maxWidth: "62ch",
                    }}
                  >
                    {detail!.conversation.summary}
                  </p>
                )}
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
                <ExportButton
                  conversationId={detail!.conversation.id}
                  filename={`corva-${detail!.conversation.id.slice(0, 8)}.txt`}
                  onExport={exportTranscript}
                />
                <OutlineButton
                  href={`/app/live?call=${detail!.conversation.id}`}
                  style={{ fontSize: 11.5, padding: "8px 12px" }}
                >
                  Open in console
                </OutlineButton>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
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
              <div>
                <Kicker size={9.5} style={{ letterSpacing: "0.12em" }}>
                  Cost to serve
                </Kicker>
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700 }}>
                  {detail!.cost.pence > 0 ? formatCost(detail!.cost.pence) : "—"}
                </div>
                {detail!.cost.lines.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
                    {detail!.cost.lines.map((l) => (
                      <span key={l.label} style={{ display: "block" }}>
                        {l.label} {formatCost(l.pence)}
                        <span style={{ color: "var(--color-neutral-500)" }}>
                          {" "}
                          · {l.units.toLocaleString("en-GB")} {l.unit}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Kicker size={9.5} style={{ letterSpacing: "0.12em" }}>
                  Quality review
                </Kicker>
                <div style={{ marginTop: 4 }}>
                  <ReviewForm
                    conversationId={detail!.conversation.id}
                    current={detail!.conversation.reviewScore}
                    reviewer={detail!.conversation.reviewerName}
                    note={detail!.conversation.reviewNote}
                    onReview={reviewConversation}
                  />
                </div>
              </div>
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
                    <LinkAction href="/app/knowledge?tab=gaps" size={12.5}>
                      review the gaps
                    </LinkAction>
                  </div>
                )}
                {detail!.conversation.reviewNote && (
                  <div>
                    Reviewed by {detail!.conversation.reviewerName}: &ldquo;
                    {detail!.conversation.reviewNote}&rdquo;
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
