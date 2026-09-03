import Link from "next/link";
import {
  DarkAccentButton,
  DarkBar,
  DarkKicker,
  DarkOutlineButton,
  DarkTag,
  DarkTh,
  KpiCell,
  OperatorHeader,
} from "@/components/operator-ui";
import { fleetFilters, load } from "@/lib/operator-data";
import { getFleet, getReliability } from "@/lib/queries/operator";

export default async function FleetPage() {
  const [{ tenants, kpis: fleetKpis, needsAttention: needsCorva }, ops] = await Promise.all([
    getFleet(),
    getReliability(),
  ]);

  return (
    <section>
      <OperatorHeader
        kicker="All companies on Corva"
        title="Fleet"
        lede="Every tenant, what they're using, and whether their AI is behaving. Customer data stays inside each workspace — you see health, not transcripts, unless a company grants access."
      >
        <DarkOutlineButton>Feature flags</DarkOutlineButton>
        <DarkAccentButton>Onboard a company</DarkAccentButton>
      </OperatorHeader>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          borderBottom: "2px solid var(--color-neutral-700)",
        }}
      >
        {fleetKpis.map((k) => (
          <KpiCell
            key={k.label}
            label={k.label}
            value={k.value}
            delta={k.delta}
            deltaColor={k.deltaColor}
            note={k.note}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 348px" }}>
        <div style={{ borderRight: "2px solid var(--color-neutral-700)" }}>
          <div
            style={{
              padding: "12px 24px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--color-neutral-900)",
              borderBottom: "1px solid var(--color-neutral-800)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: "var(--color-bg)",
                color: "var(--color-text)",
                padding: "5px 9px",
              }}
            >
              Needs attention · {tenants.filter((t) => t.bad).length}
            </span>
            {fleetFilters.map((f) => (
              <button
                key={f}
                type="button"
                className="hov-border-dark"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid var(--color-neutral-600)",
                  padding: "4px 9px",
                  color: "var(--color-neutral-300)",
                }}
              >
                {f}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-neutral-500)" }}>
              Sorted by health, worst first
            </span>
          </div>

          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-neutral-700)" }}>
                <DarkTh padding="9px 24px">Company</DarkTh>
                <DarkTh width="12%">Plan</DarkTh>
                <DarkTh width="13%">Conv. / mo</DarkTh>
                <DarkTh width="13%">Containment</DarkTh>
                <DarkTh width="15%">AI health</DarkTh>
                <DarkTh width="12%">MRR</DarkTh>
                <DarkTh width="16%" padding="9px 24px">Flag</DarkTh>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr
                  key={t.slug}
                  className="hov-dark"
                  style={{ borderBottom: "1px solid var(--color-neutral-800)" }}
                >
                  <td style={{ padding: "11px 24px" }}>
                    <Link
                      href={`/operator/companies/${t.slug}`}
                      style={{ textAlign: "left", color: "var(--color-bg)" }}
                    >
                      <b style={{ fontSize: 13 }}>{t.name}</b>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                        {t.meta}
                      </span>
                    </Link>
                  </td>
                  <td style={{ padding: "11px 10px", color: "var(--color-neutral-300)" }}>{t.plan}</td>
                  <td style={{ padding: "11px 10px" }}>{t.conv}</td>
                  <td style={{ padding: "11px 10px" }}>{t.containment}</td>
                  <td style={{ padding: "11px 10px" }}>
                    <DarkBar width={t.healthBar} color={t.healthColor} />
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{t.health}</span>
                  </td>
                  <td style={{ padding: "11px 10px", fontWeight: 700 }}>{t.mrr}</td>
                  <td style={{ padding: "11px 24px" }}>
                    <DarkTag bg={t.tagBg} fg={t.tagFg}>
                      {t.flag}
                    </DarkTag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right rail */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-neutral-700)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  background: "var(--color-accent)",
                  display: "block",
                  animation: "cv-pulse 1.6s ease-in-out infinite",
                }}
              />
              <DarkKicker color="var(--color-bg)">Open incident</DarkKicker>
            </div>
            <div style={{ marginTop: 12, border: "2px solid var(--color-accent)", padding: "12px 13px" }}>
              <b style={{ fontSize: 13 }}>{ops.openIncident?.title ?? "No open incident"}</b>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "var(--color-neutral-300)",
                  lineHeight: 1.45,
                }}
              >
                {ops.openIncident?.note ?? "Every region is healthy."}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="hov-accent-dark"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "var(--color-accent)",
                    color: "var(--color-bg)",
                    padding: "7px 10px",
                  }}
                >
                  Fail over now
                </button>
                <button
                  type="button"
                  className="hov-invert-dark"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    border: "1px solid var(--color-bg)",
                    padding: "6px 10px",
                  }}
                >
                  Post status update
                </button>
              </div>
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-neutral-700)" }}>
            <DarkKicker>Needs a human at Corva</DarkKicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11, fontSize: 12 }}
            >
              {needsCorva.map((n) => (
                <div
                  key={n.name}
                  style={{
                    borderLeft: `3px solid ${n.urgent ? "var(--color-accent)" : "var(--color-neutral-600)"}`,
                    paddingLeft: 10,
                  }}
                >
                  <b>{n.name}</b>
                  <div style={{ color: "var(--color-neutral-400)", marginTop: 3 }}>{n.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <DarkKicker>Platform load · last 24h</DarkKicker>
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                height: 76,
                borderBottom: "1px solid var(--color-neutral-700)",
              }}
            >
              {load.map((l, i) => (
                <span key={i} style={{ flex: 1, display: "block", background: l.color, height: l.h }} />
              ))}
            </div>
            <div
              style={{
                marginTop: 7,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--color-neutral-500)",
              }}
            >
              <span>00:00</span>
              <span>peak 1,842 concurrent</span>
              <span>now</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
