import { DarkSectionTitle, DarkTag, DarkTh, OperatorHeader } from "@/components/operator-ui";
import { IncidentUpdateForm } from "@/components/IncidentUpdateForm";
import { postIncidentUpdate } from "@/lib/actions/operator";
import { getReliability } from "@/lib/queries/operator";

export default async function ReliabilityPage() {
  const { regions, incidents, dependencies } = await getReliability();

  return (
    <section>
      <OperatorHeader
        kicker={`${regions.length} regions · ${incidents.filter((i) => i.when === "Now").length} open incident${incidents.filter((i) => i.when === "Now").length === 1 ? "" : "s"}`}
        title="Reliability"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* Regions & dependencies */}
        <div style={{ borderRight: "2px solid var(--color-neutral-700)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-800)" }}>
            <DarkSectionTitle style={{ marginBottom: 14 }}>Regions</DarkSectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-neutral-700)" }}>
                  <DarkTh padding="8px 0">Region</DarkTh>
                  <DarkTh padding="8px 10px">Companies</DarkTh>
                  <DarkTh padding="8px 10px">Voice p95</DarkTh>
                  <DarkTh padding="8px 10px">Uptime 30d</DarkTh>
                  <DarkTh padding="8px 0">State</DarkTh>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.name} style={{ borderBottom: "1px solid var(--color-neutral-800)" }}>
                    <td style={{ padding: "10px 0" }}>
                      <b>{r.name}</b>
                    </td>
                    <td style={{ padding: "10px 10px", color: "var(--color-neutral-400)" }}>{r.tenants}</td>
                    <td style={{ padding: "10px 10px", color: r.color, fontWeight: 600 }}>{r.p95}</td>
                    <td style={{ padding: "10px 10px", color: "var(--color-neutral-400)" }}>{r.uptime}</td>
                    <td style={{ padding: "10px 0" }}>
                      <DarkTag bg={r.tagBg} fg={r.tagFg}>
                        {r.state}
                      </DarkTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <DarkSectionTitle style={{ marginBottom: 12 }}>Dependencies</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {dependencies.map((d, i) => (
                <div
                  key={d.name}
                  style={{
                    display: "flex",
                    gap: 12,
                    paddingBottom: i < dependencies.length - 1 ? 10 : undefined,
                    borderBottom:
                      i < dependencies.length - 1 ? "1px solid var(--color-neutral-800)" : undefined,
                  }}
                >
                  <b style={{ width: 150 }}>{d.name}</b>
                  <span style={{ flex: 1, color: "var(--color-neutral-400)" }}>
                    {d.provider}
                    {d.note && (
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                        {d.note}
                      </span>
                    )}
                  </span>
                  <span style={{ width: 56, textAlign: "right", color: "var(--color-neutral-400)" }}>
                    {d.latency}
                  </span>
                  <span
                    style={{
                      width: 74,
                      textAlign: "right",
                      color: d.bad ? "var(--color-accent-400)" : "var(--color-neutral-300)",
                      fontWeight: d.bad ? 700 : 400,
                    }}
                  >
                    {d.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Incidents */}
        <div style={{ padding: "18px 24px" }}>
          <DarkSectionTitle style={{ marginBottom: 12 }}>Incident timeline</DarkSectionTitle>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {incidents.map((i) => (
              <div
                key={i.id}
                style={{
                  padding: "13px 0",
                  borderTop: "1px solid var(--color-neutral-800)",
                  display: "grid",
                  gridTemplateColumns: "92px 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700 }}>{i.when}</div>
                  <div style={{ fontSize: 10.5, color: "var(--color-neutral-500)" }}>{i.dur}</div>
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                    <b style={{ fontSize: 13 }}>{i.title}</b>
                    <DarkTag bg={i.tagBg} fg={i.tagFg} padding="3px 6px">
                      {i.sev}
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
                    {i.note}
                    {i.affected > 0 && (
                      <span style={{ color: "var(--color-neutral-500)" }}>
                        {" "}
                        · {i.affected} compan{i.affected === 1 ? "y" : "ies"} affected
                      </span>
                    )}
                  </div>

                  {i.updates.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        borderLeft: "2px solid var(--color-neutral-800)",
                        paddingLeft: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {i.updates.map((u) => (
                        <div key={u.id} style={{ fontSize: 11.5 }}>
                          <span
                            style={{
                              fontWeight: 700,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              fontSize: 9.5,
                              color:
                                u.stage === "resolved"
                                  ? "var(--color-neutral-400)"
                                  : "var(--color-accent-400)",
                            }}
                          >
                            {u.stage}
                          </span>
                          <span style={{ color: "var(--color-neutral-500)" }}> · {u.when}</span>
                          {u.author && (
                            <span style={{ color: "var(--color-neutral-500)" }}> · {u.author}</span>
                          )}
                          <div style={{ marginTop: 3, color: "var(--color-neutral-300)", lineHeight: 1.45 }}>
                            {u.body}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {i.open && (
                    <div style={{ marginTop: 12 }}>
                      <IncidentUpdateForm incidentId={i.id} onPost={postIncidentUpdate} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "13px 15px",
              background: "var(--color-neutral-900)",
              borderLeft: "3px solid var(--color-accent)",
              fontSize: 12,
              color: "var(--color-neutral-300)",
              lineHeight: 1.5,
            }}
          >
            Every incident that touched a company&rsquo;s calls is published to their own status page
            automatically, with the minutes affected and whether their SLA credit applies.
          </div>
        </div>
      </div>
    </section>
  );
}
