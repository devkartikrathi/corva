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
import Link from "next/link";
import { DarkChip } from "@/components/operator-filters";
import { TriageControl } from "@/components/TriageControl";
import { triageQualityFlag } from "@/lib/actions/operator";
import { normalise, type RawParams } from "@/lib/params";
import { getFleetQuality } from "@/lib/queries/operator";

const PATH = "/operator/quality";

export default async function AiQualityPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const params = normalise(await searchParams);
  const ctx = { pathname: PATH, params };

  const {
    kpis: qualityKpis,
    flagged: flaggedTurns,
    counts,
    patterns,
    rollout,
  } = await getFleetQuality({ status: params.status, owner: params.owner });

  return (
    <section>
      <OperatorHeader
        kicker="Cross-tenant · anonymised until access is granted"
        title="AI quality"
        lede="Model behaviour across the whole fleet — the failures worth fixing once, centrally, instead of 148 times."
      >
        <DarkOutlineButton href="/operator/reliability">Reliability</DarkOutlineButton>
        <DarkAccentButton href="/operator">Back to the fleet</DarkAccentButton>
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
              <DarkSectionTitle>Flagged answers</DarkSectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)" }}>
                Company names shown; content withheld unless access is granted
              </span>
            </div>
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                gap: 7,
                flexWrap: "wrap",
              }}
            >
              <Link
                href={PATH}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${params.status || params.owner ? "var(--color-neutral-600)" : "var(--color-bg)"}`,
                  background: params.status || params.owner ? "transparent" : "var(--color-bg)",
                  color: params.status || params.owner ? "var(--color-neutral-300)" : "var(--color-text)",
                  padding: "4px 9px",
                }}
              >
                All {counts.total}
              </Link>
              <DarkChip ctx={ctx} paramKey="status" value="open" label={`Open ${counts.open}`} />
              <DarkChip ctx={ctx} paramKey="status" value="triaged" label={`Triaged ${counts.triaged}`} />
              <DarkChip ctx={ctx} paramKey="status" value="fixed" label={`Fixed ${counts.fixed}`} />
              <span style={{ width: 1, height: 16, background: "var(--color-neutral-700)" }} />
              <DarkChip ctx={ctx} paramKey="owner" value="corva" label={`Ours ${counts.corva}`} />
              <DarkChip ctx={ctx} paramKey="owner" value="tenant" label={`Theirs ${counts.tenant}`} />
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
                  <DarkTh padding="9px 0">Company &amp; failure</DarkTh>
                  <DarkTh width={150}>Class</DarkTh>
                  <DarkTh width={86}>Age</DarkTh>
                  <DarkTh width={190} padding="9px 0">Triage</DarkTh>
                </tr>
              </thead>
              <tbody>
                {flaggedTurns.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ padding: "18px 0", fontSize: 12.5, color: "var(--color-neutral-400)" }}
                    >
                      Nothing flagged across the fleet. Turns land here when the AI answers without a
                      citation, or a guardrail catches something.
                    </td>
                  </tr>
                )}
                {flaggedTurns.map((f) => (
                  <tr
                    key={f.id}
                    className="hov-dark"
                    style={{ borderBottom: "1px solid var(--color-neutral-800)" }}
                  >
                    <td style={{ padding: "11px 0", verticalAlign: "top" }}>
                      <Link
                        href={`/operator/companies/${f.companySlug}`}
                        style={{ color: "var(--color-bg)" }}
                      >
                        <b>{f.company}</b>
                      </Link>
                      <span
                        style={{
                          display: "block",
                          marginTop: 3,
                          fontSize: 11.5,
                          color: "var(--color-neutral-400)",
                          lineHeight: 1.45,
                          maxWidth: "52ch",
                        }}
                      >
                        {f.summary}
                        {f.cause !== "—" && (
                          <span style={{ display: "block", color: "var(--color-neutral-500)" }}>
                            Cause: {f.cause}
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: "11px 10px", color: f.color, verticalAlign: "top" }}>
                      {f.klass}
                    </td>
                    <td
                      style={{ padding: "11px 10px", color: "var(--color-neutral-400)", verticalAlign: "top" }}
                    >
                      {f.age}
                    </td>
                    <td style={{ padding: "11px 0", verticalAlign: "top" }}>
                      <TriageControl
                        flagId={f.id}
                        status={f.status}
                        owner={f.ownerKey}
                        rootCause={f.cause === "—" ? "" : f.cause}
                        onTriage={triageQualityFlag}
                      />
                    </td>
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
              {patterns.length === 0 && (
                <span style={{ color: "var(--color-neutral-400)" }}>
                  Nothing flagged yet across the fleet.
                </span>
              )}
              {patterns.map((p) => (
                <div
                  key={p.klass}
                  style={
                    p.central
                      ? { border: "2px solid var(--color-accent)", padding: "11px 12px" }
                      : {
                          border: "1px solid var(--color-neutral-700)",
                          padding: "11px 12px",
                          background: "var(--color-neutral-900)",
                        }
                  }
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b style={{ flex: 1 }}>{p.klass}</b>
                    <span
                      style={{
                        color: p.central ? "var(--color-accent-400)" : "var(--color-neutral-400)",
                        fontWeight: 700,
                      }}
                    >
                      {p.count}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      color: p.central ? "var(--color-neutral-300)" : "var(--color-neutral-400)",
                      lineHeight: 1.45,
                    }}
                  >
                    {p.companies} compan{p.companies === 1 ? "y" : "ies"}, {p.open} still open.{" "}
                    {p.central
                      ? "Seen at more than one tenant and mostly ours — fix it once, centrally."
                      : "Confined to a tenant's own documents."}
                  </div>
                  {p.central && (
                    <Link
                      href={`${PATH}?owner=corva&status=open`}
                      className="hov-accent-dark"
                      style={{
                        display: "inline-block",
                        marginTop: 9,
                        fontSize: 11,
                        fontWeight: 700,
                        background: "var(--color-accent)",
                        color: "var(--color-bg)",
                        padding: "7px 10px",
                      }}
                    >
                      Open the queue
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <DarkKicker>Base model rollout</DarkKicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
              {rollout.map((r) => (
                <DarkStatRow
                  key={r.key}
                  label={`${r.label} · ${r.stage}`}
                  value={`${r.companies} compan${r.companies === 1 ? "y" : "ies"}`}
                  valueColor={r.stage === "alpha" || r.stage === "internal" ? "var(--color-accent-400)" : undefined}
                />
              ))}
            </div>
            <p
              style={{
                marginTop: 12,
                fontSize: 11.5,
                color: "var(--color-neutral-500)",
                lineHeight: 1.45,
              }}
            >
              Counts are rows in <code>org_feature_flags</code>, not the target percentage — a
              rollout is what is actually on, not what was planned.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
