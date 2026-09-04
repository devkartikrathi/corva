import Link from "next/link";
import {
  DeltaRow,
  Kicker,
  OutlineButton,
  ScreenHeader,
  SectionTitle,
  Tag,
} from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { RuleBuilder } from "@/components/RuleBuilder";
import { WeightDial } from "@/components/WeightDial";
import { getScoringModel } from "@/lib/queries/segments";
import {
  acknowledgeAlert,
  createRule,
  deleteRule,
  setAxisWeight,
  toggleRule,
} from "@/lib/actions/workspace";
import { RULE_ACTIONS, RULE_FIELDS, RULE_OPS } from "@/lib/rules";
import { rescore } from "@/lib/actions/workspace";
import { ActionButton, ActionToggle } from "@/components/ActionButton";

export default async function SegmentsPage() {
  const { brand } = await getConsoleContext();
  const { weights, rules, segments, distribution, simulation, alerts, scoredCount } =
    await getScoringModel(brand.id);

  return (
    <section>
      <ScreenHeader
        kicker={`Scoring model · ${brand.name}`}
        title="Segments & priority rules"
        lede="The model proposes a score. Your rules have the last word — and every override is attributed."
      >
        <OutlineButton href="/app/customers?sort=score:desc">
          See the ranking
        </OutlineButton>
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
              <WeightDial
                key={w.key}
                axisKey={w.key}
                label={w.label}
                weight={w.value}
                source={w.source}
                onChange={setAxisWeight}
              />
            ))}
          </div>
          <p
            style={{
              marginTop: 16,
              fontSize: 11.5,
              color: "var(--color-neutral-700)",
              lineHeight: 1.5,
            }}
          >
            Every change rescores the brand immediately, so the distribution and the queue below
            move as you tune. An axis at zero is still collected — it just stops counting.
          </p>
        </div>

        {/* Override rules */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "18px 24px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <SectionTitle size={16}>Override rules</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                Applied top to bottom
              </span>
              <RuleBuilder
                fields={RULE_FIELDS}
                ops={RULE_OPS}
                actions={RULE_ACTIONS}
                onCreate={createRule}
              />
            </div>
          </div>

          {rules.map((r) => (
            <div
              key={r.id}
              className="hov-surface"
              style={{ padding: "13px 24px", borderTop: "1px solid var(--color-neutral-300)" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ fontSize: 13 }}>{r.name}</b>
                <Tag bg={r.tagBg} fg={r.tagFg} padding="3px 6px">
                  {r.effect}
                </Tag>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>
                  fires for {r.matches}
                </span>
                <ActionToggle
                  on={r.enabled}
                  label={`${r.name} enabled`}
                  action={async (next) => {
                    "use server";
                    await toggleRule(r.id, next);
                  }}
                />
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
              <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{r.author}</span>
                <span style={{ marginLeft: "auto" }}>
                  <ActionButton
                    variant="hairline"
                    pendingLabel="Removing…"
                    confirm={`Delete "${r.name}"? Every customer is rescored without it.`}
                    style={{ fontSize: 10.5, padding: "3px 7px" }}
                    action={async () => {
                      "use server";
                      await deleteRule(r.id);
                    }}
                  >
                    Delete
                  </ActionButton>
                </span>
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
                <Link
                  key={s.id}
                  href={s.href}
                  className="hov-ink"
                  style={{
                    color: "var(--color-text)",
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
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Simulation */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Simulation</Kicker>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-neutral-800)" }}>
              What your rules do to the model, across {scoredCount} scored customer
              {scoredCount === 1 ? "" : "s"}:
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {simulation.map((sim) => (
                <DeltaRow key={sim.label} label={sim.label} from={sim.from} to={sim.to} hot={sim.hot} />
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
              {distribution.map((d, i) => (
                <span
                  key={i}
                  title={`${d.count} customer${d.count === 1 ? "" : "s"} between ${d.from} and ${d.from + 5}`}
                  style={{ flex: 1, display: "block", background: d.color, height: d.h }}
                />
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
              {alerts.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Nothing to flag. Drift, stale signals and conflicting rules appear here as the
                  rescore job finds them.
                </span>
              )}
              {alerts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    borderLeft: `3px solid ${a.hot ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                    paddingLeft: 10,
                    opacity: a.open ? 1 : 0.6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <b style={{ flex: 1 }}>{a.title}</b>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: a.hot ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                      }}
                    >
                      {a.kind.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div style={{ color: "var(--color-neutral-800)", marginTop: 3, lineHeight: 1.45 }}>
                    {a.detail}
                  </div>
                  {a.open ? (
                    <ActionButton
                      variant="hairline"
                      pendingLabel="Marking…"
                      style={{ marginTop: 6, fontSize: 10.5, padding: "3px 7px" }}
                      action={async () => {
                        "use server";
                        await acknowledgeAlert(a.id);
                      }}
                    >
                      Acknowledge
                    </ActionButton>
                  ) : (
                    <div style={{ marginTop: 5, fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                      Acknowledged by {a.acknowledgedBy ?? "someone"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
