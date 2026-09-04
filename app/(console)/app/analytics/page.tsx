import {
  Bar,
  ChartLegend,
  Kicker,
  LinkAction,
  ScreenHeader,
  SectionTitle,
  StackedBar,
  StatRow,
  Th,
} from "@/components/ui";
import { Chip } from "@/components/filters";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { getConsoleContext } from "@/lib/auth/context";
import { exportAnalyticsCsv } from "@/lib/actions/analytics";
import { intOf, normalise, type RawParams } from "@/lib/params";
import {
  agentPerformance,
  getBrandMetrics,
  qualityMetrics,
  unfinishedIntents,
  weeklyContainment,
} from "@/lib/queries/analytics";

const PATH = "/app/analytics";
/** The windows the header offers, in weeks. */
const WINDOWS = [
  { value: "4", label: "4 weeks" },
  { value: "12", label: "12 weeks" },
  { value: "26", label: "26 weeks" },
];

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const clock = (secs: number) =>
  secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { brand, session } = await getConsoleContext();
  const params = normalise(await searchParams);
  const ctx = { pathname: PATH, params };

  // Every figure on this screen is measured over the same window, so changing
  // it changes the KPIs and the chart together rather than only the chart.
  const weeksBack = intOf(params, "weeks", 12, 1, 52);
  const from = new Date(Date.now() - weeksBack * 7 * 864e5);

  const [m, containment, intents, qualityReview, agents] = await Promise.all([
    getBrandMetrics(brand.id, { from }),
    weeklyContainment(brand.id, weeksBack),
    unfinishedIntents(brand.id),
    qualityMetrics(brand.id),
    agentPerformance(session.orgId),
  ]);

  const { weeks, weeksCovered } = containment;
  const channelMix = m.channelMix;

  const kpis = [
    {
      label: "AI containment",
      value: `${m.containment.toFixed(1)}%`,
      delta: `${m.contained}/${m.total}`,
      note: "resolved without a human",
      deltaColor: "var(--color-neutral-800)",
    },
    {
      label: "Escalation rate",
      value: `${m.total ? ((m.escalated / m.total) * 100).toFixed(1) : "0.0"}%`,
      delta: String(m.escalated),
      note: "needed a person",
      deltaColor: "var(--color-accent-700)",
    },
    {
      label: "Cost per contact",
      value: money(m.costPerContactPence),
      delta: "£4.90",
      note: "human baseline",
      deltaColor: "var(--color-neutral-800)",
    },
    {
      label: "Avg handle time",
      value: clock(m.avgHandleSeconds),
      delta: "",
      note: "across all channels",
      deltaColor: "var(--color-neutral-800)",
    },
    {
      label: "Avg sentiment",
      value: `${m.avgSentiment >= 0 ? "+" : "−"}${Math.abs(m.avgSentiment).toFixed(2)}`,
      delta: "",
      note: "at close",
      deltaColor: "var(--color-neutral-800)",
    },
    {
      label: "Review score",
      value: m.avgReview ? `${m.avgReview.toFixed(1)} / 5` : "—",
      delta: "",
      note: "human-reviewed calls",
      deltaColor: "var(--color-neutral-800)",
    },
  ];

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${m.total} conversation${m.total === 1 ? "" : "s"} in the last ${weeksBack} weeks`}
        title="Analytics & AI performance"
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {WINDOWS.map((w) => (
            <Chip key={w.value} ctx={ctx} paramKey="weeks" value={w.value} label={w.label} />
          ))}
        </span>
        <ExportCsvButton
          filename={`corva-analytics-${brand.slug}-${weeksBack}w.csv`}
          query={params}
          onExport={exportAnalyticsCsv}
        />
      </ScreenHeader>

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{ padding: "15px 18px", borderRight: "1px solid var(--color-neutral-300)" }}
          >
            <Kicker size={9.5} style={{ letterSpacing: "0.12em" }}>
              {k.label}
            </Kicker>
            <div
              style={{
                marginTop: 7,
                fontWeight: 800,
                fontSize: 26,
                lineHeight: 1,
                letterSpacing: "-0.025em",
              }}
            >
              {k.value}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: "var(--color-neutral-700)" }}>
              <b style={{ color: k.deltaColor }}>{k.delta}</b> {k.note}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px" }}>
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {/* Containment */}
          <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <SectionTitle size={16}>Containment vs. escalation</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                Weekly · every channel ·{" "}
                {weeksCovered === 0
                  ? "no history yet"
                  : `${weeksCovered} week${weeksCovered === 1 ? "" : "s"} of history`}
              </span>
              <ChartLegend style={{ marginLeft: "auto" }} />
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "flex-end",
                gap: 10,
                height: 168,
                borderBottom: "2px solid var(--color-divider)",
              }}
            >
              {weeks.map((w, i) => (
                <StackedBar key={i} ai={w.ai} human={w.human} />
              ))}
            </div>
            <div
              style={{
                marginTop: 7,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10.5,
                color: "var(--color-neutral-700)",
              }}
            >
              <span>{weeksCovered ? `${weeksCovered} weeks ago` : ""}</span>
              <span>{weeksCovered ? "this week" : ""}</span>
            </div>
          </div>

          {/* Unfinished intents */}
          <div style={{ padding: "18px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <SectionTitle size={16}>What the AI still can&rsquo;t finish</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                Ranked by the value of fixing it
              </span>
            </div>
            <table
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12.5 }}
            >
              <thead>
                <tr
                  style={{
                    borderTop: "2px solid var(--color-divider)",
                    borderBottom: "2px solid var(--color-divider)",
                  }}
                >
                  <Th padding="8px 0">Intent</Th>
                  <Th width={88} padding="8px 10px">Calls</Th>
                  <Th width={128} padding="8px 10px">Why it fails</Th>
                  <Th width={104} padding="8px 10px">Human cost</Th>
                  <Th width={116} padding="8px 0">Fix</Th>
                </tr>
              </thead>
              <tbody>
                {intents.map((i) => (
                  <tr
                    key={i.name}
                    className="hov-surface"
                    style={{ borderBottom: "1px solid var(--color-neutral-300)" }}
                  >
                    <td style={{ padding: "10px 0" }}>
                      <b>{i.name}</b>
                    </td>
                    <td style={{ padding: "10px 10px" }}>{i.calls}</td>
                    <td style={{ padding: "10px 10px", color: i.reasonColor }}>{i.reason}</td>
                    <td style={{ padding: "10px 10px", fontWeight: 600 }}>{i.cost}</td>
                    <td style={{ padding: "10px 0" }}>
                      <LinkAction href={i.to} size={11}>
                        {i.fix} →
                      </LinkAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right rail */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>AI quality review</Kicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
              {qualityReview.map((q) => (
                <StatRow
                  key={q.label}
                  label={q.label}
                  value={q.value}
                  valueColor={q.hot ? "var(--color-accent-700)" : undefined}
                />
              ))}
            </div>
            <LinkAction href="/app/conversations" size={11} style={{ marginTop: 12, display: "block" }}>
              Open the archive →
            </LinkAction>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Team</Kicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}
            >
              {agents.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
                  Nobody has taken a handoff yet. Accept one and the person who did appears here.
                </div>
              )}
              {agents.map((a) => (
                <div
                  key={a.name}
                  style={{ paddingBottom: 9, borderBottom: "1px solid var(--color-neutral-300)" }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b style={{ flex: 1 }}>{a.name}</b>
                    <span style={{ color: "var(--color-neutral-700)" }}>{a.role}</span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      gap: 12,
                      color: "var(--color-neutral-800)",
                    }}
                  >
                    <span>
                      {a.handled} handoff{a.handled === "1" ? "" : "s"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Channel mix</Kicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}
            >
              {channelMix.map((c) => (
                <div key={c.name}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <b>{c.share}</b>
                  </div>
                  <Bar
                    width={c.share}
                    color={c.primary ? "var(--color-accent)" : "var(--color-neutral-500)"}
                    style={{ marginTop: 4 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
