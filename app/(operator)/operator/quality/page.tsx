import {
  DarkAccentButton,
  DarkKicker,
  DarkOutlineButton,
  DarkSectionTitle,
  DarkStatRow,
  DarkTh,
  KpiCell,
  OperatorHeader,
} from "@/components/operator-ui";
import { centralPatterns, rollout } from "@/lib/operator-data";
import { getFleetQuality } from "@/lib/queries/operator";

export default async function AiQualityPage() {
  const { kpis: qualityKpis, flagged: flaggedTurns } = await getFleetQuality();

  return (
    <section>
      <OperatorHeader
        kicker="Cross-tenant · anonymised until access is granted"
        title="AI quality"
        lede="Model behaviour across the whole fleet — the failures worth fixing once, centrally, instead of 148 times."
      >
        <DarkOutlineButton>Export eval set</DarkOutlineButton>
        <DarkAccentButton>Ship a base-model change</DarkAccentButton>
      </OperatorHeader>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          borderBottom: "2px solid var(--color-neutral-700)",
        }}
      >
        {qualityKpis.map((k, i) => (
          <KpiCell
            key={k.label}
            label={k.label}
            value={k.value}
            note={k.note}
            last={i === qualityKpis.length - 1}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px" }}>
        <div style={{ borderRight: "2px solid var(--color-neutral-700)" }}>
          <div style={{ padding: "18px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <DarkSectionTitle>Flagged turns awaiting review</DarkSectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)" }}>
                Company names shown; content withheld unless access is granted
              </span>
            </div>
            <table
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12.5 }}
            >
              <thead>
                <tr
                  style={{
                    borderTop: "2px solid var(--color-neutral-700)",
                    borderBottom: "2px solid var(--color-neutral-700)",
                  }}
                >
                  <DarkTh padding="9px 0">Company</DarkTh>
                  <DarkTh width={168}>Failure class</DarkTh>
                  <DarkTh width={92}>Turns</DarkTh>
                  <DarkTh width={120}>Root cause</DarkTh>
                  <DarkTh width={116} padding="9px 0">Owner</DarkTh>
                </tr>
              </thead>
              <tbody>
                {flaggedTurns.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: "18px 0", fontSize: 12.5, color: "var(--color-neutral-400)" }}
                    >
                      Nothing flagged across the fleet. Turns land here when the AI answers without a
                      citation, or a guardrail catches something.
                    </td>
                  </tr>
                )}
                {flaggedTurns.map((f) => (
                  <tr
                    key={`${f.company}-${f.klass}-${f.cause}`}
                    className="hov-dark"
                    style={{ borderBottom: "1px solid var(--color-neutral-800)" }}
                  >
                    <td style={{ padding: "10px 0" }}>
                      <b>{f.company}</b>
                    </td>
                    <td style={{ padding: "10px 10px", color: f.color }}>{f.klass}</td>
                    <td style={{ padding: "10px 10px" }}>{f.turns}</td>
                    <td style={{ padding: "10px 10px", color: "var(--color-neutral-400)" }}>{f.cause}</td>
                    <td style={{ padding: "10px 0", color: "var(--color-neutral-400)" }}>{f.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-neutral-700)" }}>
            <DarkKicker>Patterns worth fixing centrally</DarkKicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}
            >
              {centralPatterns.map((p) =>
                p.primary ? (
                  <div key={p.title} style={{ border: "2px solid var(--color-accent)", padding: "11px 12px" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <b style={{ flex: 1 }}>{p.title}</b>
                      <span style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>{p.count}</span>
                    </div>
                    <div style={{ marginTop: 5, color: "var(--color-neutral-300)", lineHeight: 1.45 }}>
                      {p.body}
                    </div>
                    <button
                      type="button"
                      className="hov-accent-dark"
                      style={{
                        marginTop: 9,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--color-accent)",
                        color: "var(--color-bg)",
                        padding: "7px 10px",
                      }}
                    >
                      Open eval &amp; patch
                    </button>
                  </div>
                ) : (
                  <div
                    key={p.title}
                    style={{
                      border: "1px solid var(--color-neutral-700)",
                      padding: "11px 12px",
                      background: "var(--color-neutral-900)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8 }}>
                      <b style={{ flex: 1 }}>{p.title}</b>
                      <span style={{ color: "var(--color-neutral-400)", fontWeight: 700 }}>{p.count}</span>
                    </div>
                    <div style={{ marginTop: 5, color: "var(--color-neutral-400)" }}>{p.body}</div>
                  </div>
                ),
              )}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <DarkKicker>Base model rollout</DarkKicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
              {rollout.map((r) => (
                <DarkStatRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  valueColor={r.hot ? "var(--color-accent-400)" : undefined}
                />
              ))}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button
                type="button"
                className="hov-accent-dark"
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: "var(--color-accent)",
                  color: "var(--color-bg)",
                  padding: "9px 12px",
                }}
              >
                Widen to 25%
              </button>
              <button
                type="button"
                className="hov-invert-dark"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  border: "1px solid var(--color-bg)",
                  padding: "8px 12px",
                }}
              >
                Halt canary
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
