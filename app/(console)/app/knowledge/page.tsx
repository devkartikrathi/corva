import { Bar, Kicker, OutlineButton, PrimaryButton, ScreenHeader, StatRow, Th } from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { syncedSources } from "@/lib/data";
import { getKnowledge } from "@/lib/queries/workspace";

export default async function KnowledgeBasePage() {
  const { brand } = await getConsoleContext();
  const kb = await getKnowledge(brand.id);
  const { documents: kbDocs, collections: kbTree, gaps, readiness } = kb;
  const kbReadiness = readiness.rows;

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${kbDocs.length} documents · AI readiness ${readiness.score}%`}
        title="Knowledge base"
        lede="The only thing the AI is allowed to answer from. Keep it here, or sync it from where it already lives."
      >
        <OutlineButton>Connect a source</OutlineButton>
        <PrimaryButton>New document</PrimaryButton>
      </ScreenHeader>

      <div style={{ display: "grid", gridTemplateColumns: "226px 1fr 316px" }}>
        {/* Collections */}
        <div style={{ borderRight: "2px solid var(--color-divider)", padding: "14px 0" }}>
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
          {kbTree.map((k) => (
            <button
              key={k.name}
              type="button"
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
              }}
            >
              <span style={{ width: 3, height: 14, display: "block", background: k.edge }} />
              <span style={{ flex: 1 }}>{k.name}</span>
              <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{k.count}</span>
            </button>
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
              {syncedSources.map((s) => (
                <div key={s.name} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.name}</span>
                  <span
                    style={{
                      color: s.failed ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                    }}
                  >
                    {s.when}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Documents */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                <Th padding="9px 24px">Document</Th>
                <Th width={108} padding="9px 10px">Used by AI</Th>
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
                    <b style={{ fontSize: 13 }}>{d.title}</b>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                      {d.meta}
                    </span>
                  </td>
                  <td style={{ padding: "11px 10px" }}>
                    <b>{d.uses}</b>
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}> /wk</span>
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

        {/* Gaps and readiness */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker color="var(--color-accent-700)">Gaps the AI hit this month</Kicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11 }}>
              {gaps.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
                  No gaps recorded. Every question the AI has been asked was covered by a document.
                </div>
              )}
              {gaps[0] && (
              <div style={{ border: "2px solid var(--color-text)", padding: "11px 12px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 12.5, flex: 1 }}>{gaps[0].intent}</b>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent-700)" }}>
                    {gaps[0].hits} call{gaps[0].hits === 1 ? "" : "s"}
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
                  Reason: {gaps[0].reason.replace(/_/g, " ")}. Every unanswered call is counted here
                  and priced on the Analytics screen.
                </div>
                <div style={{ marginTop: 9, display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="hov-accent"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      background: "var(--color-accent)",
                      color: "var(--color-bg)",
                      padding: "7px 10px",
                    }}
                  >
                    Review draft
                  </button>
                  <button
                    type="button"
                    className="hov-invert"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      border: "1px solid var(--color-text)",
                      padding: "6px 10px",
                    }}
                  >
                    See calls
                  </button>
                </div>
              </div>
              )}

              {gaps.slice(1, 4).map((g) => (
                <div
                  key={g.id}
                  style={{
                    border: "1px solid var(--color-neutral-400)",
                    padding: "11px 12px",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b style={{ fontSize: 12.5, flex: 1 }}>{g.intent}</b>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-neutral-700)" }}>
                      {g.hits} call{g.hits === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--color-neutral-800)" }}>
                    {g.reason.replace(/_/g, " ")}
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
              Readiness counts what the AI can actually reach for: {readiness.indexed} chunk
              {readiness.indexed === 1 ? " is" : "s are"} indexed and searchable.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
