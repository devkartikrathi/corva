import {
  DarkAccentButton,
  DarkBar,
  DarkOutlineButton,
  DarkSectionTitle,
  DarkStatRow,
  DarkTag,
  KpiCell,
  OperatorHeader,
} from "@/components/operator-ui";
import { getFleetRevenue } from "@/lib/queries/operator";

export default async function RevenuePage() {
  const {
    kpis: revenueKpis,
    planMix,
    atRisk,
    mrrByMonth,
    unitEconomics,
  } = await getFleetRevenue();

  return (
    <section>
      <OperatorHeader
        kicker={`${planMix.reduce((a, p) => a + Number(p.value.split(" ")[0]), 0)} companies · ${planMix.length} plans`}
        title="Revenue & plans"
      >
        <DarkOutlineButton>Export to finance</DarkOutlineButton>
        <DarkAccentButton>Edit plan tiers</DarkAccentButton>
      </OperatorHeader>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          borderBottom: "2px solid var(--color-neutral-700)",
        }}
      >
        {revenueKpis.map((k, i) => (
          <KpiCell
            key={k.label}
            label={k.label}
            value={k.value}
            note={k.note}
            deltaColor="var(--color-accent-400)"
            last={i === revenueKpis.length - 1}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* MRR and plan mix */}
        <div style={{ borderRight: "2px solid var(--color-neutral-700)", padding: "18px 24px" }}>
          <DarkSectionTitle style={{ marginBottom: 14 }}>MRR by month</DarkSectionTitle>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              height: 170,
              borderBottom: "2px solid var(--color-neutral-700)",
            }}
          >
            {mrrByMonth.map((m, i) => (
              <span
                key={i}
                title={`${m.label} · ${m.mrr}`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  height: "100%",
                }}
              >
                <span style={{ display: "block", background: m.color, height: m.h }} />
              </span>
            ))}
          </div>
          <div
            style={{
              marginTop: 7,
              display: "flex",
              gap: 18,
              fontSize: 11,
              color: "var(--color-neutral-500)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, background: "var(--color-accent)", display: "block" }} />
              Best month so far
            </span>
            <span>Recorded monthly, not projected</span>
            <span style={{ marginLeft: "auto" }}>
              {mrrByMonth[0]?.label} → {mrrByMonth[mrrByMonth.length - 1]?.label}
            </span>
          </div>

          <DarkSectionTitle style={{ margin: "24px 0 14px" }}>Plan mix</DarkSectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
            {planMix.map((p) => (
              <div key={p.label}>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ flex: 1 }}>{p.label}</span>
                  <b>{p.value}</b>
                </div>
                <DarkBar width={p.bar} color={p.color} style={{ marginTop: 5 }} />
              </div>
            ))}
          </div>
        </div>

        {/* At risk and unit economics */}
        <div>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-800)" }}>
            <DarkSectionTitle style={{ marginBottom: 4 }}>At risk</DarkSectionTitle>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--color-neutral-500)" }}>
              Scored the same way tenants score their own customers — usage, sentiment from support
              tickets, and champion activity.
            </p>
            {atRisk.map((r) => (
              <div key={r.name} style={{ padding: "12px 0", borderTop: "1px solid var(--color-neutral-800)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <b style={{ fontSize: 13, flex: 1 }}>{r.name}</b>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{r.mrr}</span>
                  <DarkTag bg={r.tagBg} fg={r.tagFg}>
                    {r.risk}
                  </DarkTag>
                </div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 12,
                    color: "var(--color-neutral-400)",
                    lineHeight: 1.45,
                  }}
                >
                  {r.why}
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: "18px 24px" }}>
            <DarkSectionTitle style={{ marginBottom: 12 }}>Unit economics</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {unitEconomics.map((u) => (
                <DarkStatRow key={u.label} label={u.label} value={u.value} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
