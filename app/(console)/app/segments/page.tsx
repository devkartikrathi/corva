import {
  Bar,
  DeltaRow,
  Kicker,
  LinkAction,
  OutlineButton,
  PrimaryButton,
  ScreenHeader,
  SectionTitle,
  Tag,
} from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { dist, modelAlerts, simulation } from "@/lib/data";
import { getScoringModel } from "@/lib/queries/segments";
import { rescore } from "@/lib/actions/workspace";
import { ActionButton } from "@/components/ActionButton";

export default async function SegmentsPage() {
  const { brand } = await getConsoleContext();
  const { weights, rules, segments } = await getScoringModel(brand.id);

  return (
    <section>
      <ScreenHeader
        kicker={`Scoring model · ${brand.name}`}
        title="Segments & priority rules"
        lede="The model proposes a score. Your rules have the last word — and every override is attributed."
      >
        <OutlineButton>Simulate on 24,318</OutlineButton>
        <ActionButton
          action={async () => {
            "use server";
            await rescore();
          }}
          pendingLabel="Rescoring…"
        >
          Recompute every score
        </ActionButton>
      </ScreenHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 316px" }}>
        {/* Axis weights */}
        <div style={{ borderRight: "2px solid var(--color-divider)", padding: "18px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <SectionTitle size={16}>Axis weights</SectionTitle>
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              {weights.length} axes
            </span>
          </div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
            {weights.map((w) => (
              <div key={w.label}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
                  <span style={{ flex: 1, color: "var(--color-text)" }}>{w.label}</span>
                  <b>{w.weight}</b>
                  <span
                    style={{
                      width: 66,
                      textAlign: "right",
                      fontSize: 10.5,
                      color: "var(--color-neutral-700)",
                    }}
                  >
                    {w.source}
                  </span>
                </div>
                <Bar width={w.bar} color={w.color} marker="handle" style={{ marginTop: 5 }} />
              </div>
            ))}
          </div>
          <LinkAction style={{ marginTop: 16, display: "block" }}>
            + Add a custom axis from SQL or API
          </LinkAction>
        </div>

        {/* Override rules */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "18px 24px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <SectionTitle size={16}>Override rules</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                Applied top to bottom
              </span>
              <LinkAction style={{ marginLeft: "auto" }}>+ New rule</LinkAction>
            </div>
          </div>

          {rules.map((r) => (
            <div
              key={r.name}
              className="hov-surface"
              style={{ padding: "13px 24px", borderTop: "1px solid var(--color-neutral-300)" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ fontSize: 13 }}>{r.name}</b>
                <Tag bg={r.tagBg} fg={r.tagFg} padding="3px 6px">
                  {r.effect}
                </Tag>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>
                  {r.matches}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--color-neutral-800)",
                }}
              >
                <b style={{ color: "var(--color-neutral-700)" }}>IF</b> {r.condition}{" "}
                <b style={{ color: "var(--color-neutral-700)" }}>THEN</b> {r.action}
              </div>
              <div style={{ marginTop: 5, fontSize: 10.5, color: "var(--color-neutral-500)" }}>
                {r.author}
              </div>
            </div>
          ))}

          <div style={{ padding: "18px 24px", borderTop: "2px solid var(--color-divider)" }}>
            <Kicker>Saved segments</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 9,
                fontSize: 12.5,
              }}
            >
              {segments.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <b style={{ flex: 1 }}>{s.name}</b>
                  <span style={{ color: "var(--color-neutral-700)" }}>{s.count}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: "var(--color-neutral-500)",
                      width: 80,
                      textAlign: "right",
                    }}
                  >
                    {s.owner}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Simulation */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Simulation</Kicker>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-neutral-800)" }}>
              If you save this model:
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {simulation.map((s) => (
                <DeltaRow key={s.label} label={s.label} from={s.from} to={s.to} hot={s.hot} />
              ))}
            </div>

            <div
              style={{
                marginTop: 14,
                height: 88,
                display: "flex",
                alignItems: "flex-end",
                gap: 4,
                borderBottom: "1px solid var(--color-neutral-400)",
              }}
            >
              {dist.map((d, i) => (
                <span key={i} style={{ flex: 1, display: "block", background: d.color, height: d.h }} />
              ))}
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--color-neutral-700)",
              }}
            >
              <span>Priority 0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Alerts from this model</Kicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}
            >
              {modelAlerts.map((a) => (
                <div
                  key={a.name}
                  style={{
                    borderLeft: `3px solid ${a.urgent ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                    paddingLeft: 10,
                  }}
                >
                  <b>{a.name}</b>
                  <div style={{ color: "var(--color-neutral-800)", marginTop: 3 }}>{a.action}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
