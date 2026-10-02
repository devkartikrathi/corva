import Link from "next/link";
import { Bar, Kicker, OutlineButton, PrimaryButton, ScreenHeader, ScreenRefusal, StatRow, Tag, Th } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { SearchBox } from "@/components/filters";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { href, normalise, type RawParams } from "@/lib/params";
import { dismissGap, importWebsite, reindexBrand, syncSource } from "@/lib/actions/knowledge";
import { ImportWebsite } from "@/components/ImportWebsite";
import { draftFromGap } from "@/lib/actions/workspace";
import { getKnowledge } from "@/lib/queries/workspace";

const PATH = "/app/knowledge";

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { brand, denied } = await guardScreen("documents.publish");
  // The nav withholds this screen; this is what makes withholding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="Knowledge base"
        reason={refusalReason(denied)}
        next="Answers cite the document they came from, on every call in the archive."
      />
    );
  }

  const params = normalise(await searchParams);
  const ctx = { pathname: PATH, params };

  const kb = await getKnowledge(brand.id, { collection: params.collection, q: params.q });
  const { documents: kbDocs, collections: kbTree, sources, gaps, readiness } = kb;
  const kbReadiness = readiness.rows;
  // A gap can be opened from another screen; that one leads the panel.
  const gapList = params.gap
    ? [...gaps.filter((g) => g.id === params.gap), ...gaps.filter((g) => g.id !== params.gap)]
    : gaps;

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${kb.total} document${kb.total === 1 ? "" : "s"} · AI readiness ${readiness.score}%`}
        title="Knowledge base"
        lede="The only thing the AI is allowed to answer from. Keep it here, or sync it from where it already lives."
      >
        <SearchBox ctx={ctx} placeholder="Search titles and text" width={210} />
        {readiness.indexed < readiness.chunks && (
          <ActionButton
            variant="outline"
            pendingLabel="Indexing…"
            action={async () => {
              "use server";
              await reindexBrand();
            }}
          >
            Re-index {readiness.chunks - readiness.indexed}
          </ActionButton>
        )}
        <ImportWebsite onImport={importWebsite} />
        <PrimaryButton href="/app/knowledge/new">New document</PrimaryButton>
      </ScreenHeader>

      <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "226px 1fr 316px" }}>
        {/* Collections */}
        <div className="m-noborder-x" style={{ borderRight: "2px solid var(--color-divider)", padding: "14px 0" }}>
          <div
            style={{
              padding: "0 18px 8px",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-neutral-500)",
            }}
          >
            Collections
          </div>
          <Link
            href={href(PATH, params, { collection: null })}
            className="hov-surface"
            style={{
              width: "100%",
              textAlign: "left",
              padding: "7px 18px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--color-text)",
            }}
          >
            <span
              style={{
                width: 3,
                height: 14,
                display: "block",
                background: params.collection ? "transparent" : "var(--color-accent)",
              }}
            />
            <span style={{ flex: 1 }}>Everything</span>
            <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{kb.total}</span>
          </Link>
          {kbTree.map((k) => (
            <Link
              key={k.name}
              href={href(PATH, params, { collection: k.on ? null : k.name })}
              className="hov-surface"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "7px 18px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--color-text)",
              }}
            >
              <span style={{ width: 3, height: 14, display: "block", background: k.edge }} />
              <span style={{ flex: 1 }}>{k.name}</span>
              <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{k.count}</span>
            </Link>
          ))}

          <div
            style={{
              margin: "14px 18px 0",
              borderTop: "2px solid var(--color-divider)",
              paddingTop: 12,
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-500)",
              }}
            >
              Synced sources
            </div>
            <div
              style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}
            >
              {sources.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  No source connected. Documents are written here instead.
                </span>
              )}
              {sources.map((source) => (
                <div key={source.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ flex: 1 }}>{source.name}</span>
                    <span
                      style={{
                        color: source.healthy ? "var(--color-neutral-700)" : "var(--color-accent-700)",
                      }}
                    >
                      {source.healthy ? source.synced : "failed"}
                    </span>
                  </div>
                  {/*
                    What the sync actually brought in. A source that says
                    "synced 4 minutes ago" and nothing else looks healthy while
                    contributing nothing; the count is what distinguishes a
                    working connector from a connected empty one.
                  */}
                  <div style={{ marginTop: 2, fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                    {source.kind} · {source.docCount} document{source.docCount === 1 ? "" : "s"}
                  </div>
                  {source.error ? (
                    <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--color-accent-700)", lineHeight: 1.35 }}>
                      {source.error}
                    </div>
                  ) : (
                    <ActionButton
                      variant="hairline"
                      pendingLabel="Syncing…"
                      style={{ marginTop: 4, fontSize: 10.5, padding: "3px 7px" }}
                      action={async () => {
                        "use server";
                        await syncSource(source.id);
                      }}
                    >
                      Sync now
                    </ActionButton>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Documents */}
        <div className="m-noborder-x" style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div className="m-scroll">
          <table className="cv-table-wide" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                <Th padding="9px 24px">Document</Th>
                <Th width={84} padding="9px 10px">Status</Th>
                <Th width={100} padding="9px 10px">Used by AI</Th>
                <Th width={92} padding="9px 10px">Success</Th>
                <Th width={96} padding="9px 10px">Freshness</Th>
                <Th width={112} padding="9px 24px">Owner</Th>
              </tr>
            </thead>
            <tbody>
              {kbDocs.map((d) => (
                <tr
                  key={d.id}
                  className="hov-surface"
                  style={{ borderBottom: "1px solid var(--color-neutral-300)" }}
                >
                  <td style={{ padding: "11px 24px" }}>
                    <Link href={`/app/knowledge/${d.id}`} style={{ color: "var(--color-text)" }}>
                      <b style={{ fontSize: 13 }}>{d.title}</b>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                        {d.meta}
                      </span>
                    </Link>
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <Tag
                      bg={d.status === "published" ? "var(--color-neutral-200)" : "var(--color-accent-200)"}
                      fg={d.status === "published" ? "var(--color-neutral-800)" : "var(--color-accent-800)"}
                      size={9.5}
                      padding="3px 6px"
                    >
                      {d.status}
                    </Tag>
                    {d.status === "published" && !d.indexed && (
                      <span
                        style={{
                          display: "block",
                          marginTop: 3,
                          fontSize: 10,
                          color: "var(--color-accent-700)",
                          fontWeight: 700,
                        }}
                      >
                        NOT INDEXED
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <b>{d.uses}</b>
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}> cites</span>
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <Bar width={d.bar} color={d.color} />
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>{d.success}</span>
                  </td>
                  <td style={{ padding: "11px 10px", color: d.freshColor }}>{d.fresh}</td>
                  <td style={{ padding: "11px 24px", color: "var(--color-neutral-800)" }}>{d.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {kbDocs.length === 0 && (
            <p style={{ padding: "28px 24px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
              Nothing matches.{" "}
              <Link href={PATH} style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                Clear the filters
              </Link>{" "}
              or{" "}
              <Link href="/app/knowledge/new" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                write a document
              </Link>
              .
            </p>
          )}
        </div>

        {/* Gaps and readiness */}
        <div className="m-rail">
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker color="var(--color-accent-700)">Gaps the AI hit this month</Kicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11 }}>
              {gapList.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
                  No gaps recorded. Every question the AI has been asked was covered by a document.
                </div>
              )}
              {gapList.map((g, i) => (
                <div
                  key={g.id}
                  style={
                    i === 0
                      ? { border: "2px solid var(--color-text)", padding: "11px 12px" }
                      : {
                          border: "1px solid var(--color-neutral-400)",
                          padding: "11px 12px",
                          background: "var(--color-surface)",
                        }
                  }
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <b style={{ fontSize: 12.5, flex: 1 }}>{g.intent}</b>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: i === 0 ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                      }}
                    >
                      {g.hits} call{g.hits === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      fontSize: 11.5,
                      color: "var(--color-neutral-800)",
                      lineHeight: 1.45,
                    }}
                  >
                    {g.reason.replace(/_/g, " ")} · last seen {g.lastSeen}
                    {i === 0 &&
                      ". Every unanswered call is counted here and priced on the Analytics screen."}
                  </div>
                  <div style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {g.draftDocumentId ? (
                      <PrimaryButton
                        href={`/app/knowledge/${g.draftDocumentId}`}
                        style={{ fontSize: 11, padding: "7px 10px" }}
                      >
                        Review draft
                      </PrimaryButton>
                    ) : (
                      <ActionButton
                        variant="primary"
                        pendingLabel="Writing…"
                        style={{ fontSize: 11, padding: "7px 10px" }}
                        action={async () => {
                          "use server";
                          await draftFromGap(g.id);
                        }}
                      >
                        Draft it
                      </ActionButton>
                    )}
                    <OutlineButton
                      href={`/app/conversations?q=${encodeURIComponent(g.intent)}`}
                      style={{ fontSize: 11, padding: "6px 10px", borderWidth: 1 }}
                    >
                      See calls
                    </OutlineButton>
                    <ActionButton
                      variant="hairline"
                      pendingLabel="Dismissing…"
                      confirm={`Dismiss "${g.intent}"? It will come back if the AI hits it again.`}
                      style={{ fontSize: 11 }}
                      action={async () => {
                        "use server";
                        await dismissGap(g.id);
                      }}
                    >
                      Dismiss
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>AI readiness</Kicker>
            <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 40, letterSpacing: "-0.03em" }}>
                {readiness.score}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>/ 100</span>
            </div>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}
            >
              {kbReadiness.map((r) => (
                <StatRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  valueColor={r.hot ? "var(--color-accent-700)" : undefined}
                />
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                borderTop: "1px solid var(--color-neutral-300)",
                paddingTop: 12,
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.45,
              }}
            >
              Readiness counts what the AI can actually reach for: {readiness.indexed} of{" "}
              {readiness.chunks} chunk{readiness.chunks === 1 ? "" : "s"} indexed, against{" "}
              {gaps.length} intent{gaps.length === 1 ? "" : "s"} with nothing behind{" "}
              {gaps.length === 1 ? "it" : "them"}.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
