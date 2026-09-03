import {
  Bar,
  CheckSquare,
  DeltaRow,
  Kicker,
  LinkAction,
  OutlineButton,
  PrimaryButton,
  ScreenTitle,
  Th,
} from "@/components/ui";
import { notFound } from "next/navigation";
import { getConsoleContext } from "@/lib/auth/context";
import { replayDelta, tuneNav } from "@/lib/data";
import { getTuning } from "@/lib/queries/workspace";
import { publishAgentVersion } from "@/lib/actions/workspace";
import { ActionButton } from "@/components/ActionButton";

export default async function TuningPage() {
  const { brand } = await getConsoleContext();
  const tuning = await getTuning(brand.id);
  if (!tuning) notFound();

  const {
    live,
    draft,
    versions,
    persona: PERSONA,
    tone: toneSliders,
    authority,
    triggers: escalationTriggers,
    neverRules: neverDo,
  } = tuning;

  const versionHistory = versions
    .filter((v) => v.status !== "draft")
    .map((v) => ({
      version: `v${v.version}`,
      by: [
        v.publishedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        v.authorName,
      ]
        .filter(Boolean)
        .join(" · "),
      note: v.notes ?? "",
    }));

  return (
    <section>
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "flex-end",
          gap: 20,
        }}
      >
        <ScreenTitle
          kicker={`${brand.name} · agent "${brand.agentName ?? "unnamed"}"`}
          title="Tuning & guardrails"
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "2px solid var(--color-text)",
              padding: "4px 9px",
            }}
          >
            {live
              ? `v${live.version} · live since ${live.publishedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) ?? "—"}`
              : "no live version"}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "var(--color-accent-200)",
              color: "var(--color-accent-800)",
              padding: "5px 9px",
            }}
          >
            {draft ? `v${draft.version} · draft` : "no draft"}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <OutlineButton>Replay 200 past calls</OutlineButton>
          {draft ? (
            <ActionButton
              action={async () => {
                "use server";
                await publishAgentVersion();
              }}
              pendingLabel="Publishing…"
              confirm={`Publish v${draft.version}? It replaces the live version immediately.`}
            >
              Publish v{draft.version}
            </ActionButton>
          ) : (
            <PrimaryButton>No draft to publish</PrimaryButton>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 340px" }}>
        {/* Section nav */}
        <div style={{ borderRight: "2px solid var(--color-divider)", padding: "14px 0" }}>
          {tuneNav.map((t) => (
            <button
              key={t.name}
              type="button"
              className="hov-surface"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 3, height: 14, display: "block", background: t.edge }} />
              <span style={{ flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 10.5, color: t.badgeColor }}>{t.badge}</span>
            </button>
          ))}
          <div
            style={{
              margin: "14px 18px 0",
              borderTop: "2px solid var(--color-divider)",
              paddingTop: 12,
              fontSize: 11.5,
              color: "var(--color-neutral-700)",
              lineHeight: 1.45,
            }}
          >
            Each brand tunes its own agent. Nothing here is shared between brands or with other
            companies on Corva.
          </div>
        </div>

        {/* Persona, authority, guardrails */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Persona</Kicker>
            <div
              style={{
                marginTop: 10,
                border: "1px solid var(--color-neutral-400)",
                background: "var(--color-surface)",
                padding: "13px 15px",
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--color-text)",
              }}
            >
              {PERSONA}
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "16px 28px",
              }}
            >
              {toneSliders.map((s) => (
                <div key={s.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: "var(--color-neutral-800)" }}>{s.label}</span>
                    <b>{s.value}</b>
                  </div>
                  <Bar
                    width={s.bar}
                    color="var(--color-text)"
                    marker="handle"
                    markerColor="var(--color-accent)"
                  />
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10.5,
                      color: "var(--color-neutral-500)",
                    }}
                  >
                    <span>{s.low}</span>
                    <span>{s.high}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <Kicker>Authority limits</Kicker>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                What the AI may do without asking
              </span>
            </div>
            <table
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 12.5 }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-neutral-400)" }}>
                  <Th padding="7px 0">Action</Th>
                  <Th width={130} padding="7px 10px">Ceiling</Th>
                  <Th width={140} padding="7px 10px">Above that</Th>
                  <Th width={90} padding="7px 0">Used /wk</Th>
                </tr>
              </thead>
              <tbody>
                {authority.map((a) => (
                  <tr key={a.action} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                    <td style={{ padding: "9px 0" }}>
                      <b>{a.action}</b>
                    </td>
                    <td style={{ padding: "9px 10px", color: a.color, fontWeight: 600 }}>{a.ceiling}</td>
                    <td style={{ padding: "9px 10px", color: "var(--color-neutral-800)" }}>
                      {a.escalate}
                    </td>
                    <td style={{ padding: "9px 0", color: "var(--color-neutral-700)" }}>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <div>
                <Kicker>Escalation triggers</Kicker>
                <div
                  style={{
                    marginTop: 11,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 12.5,
                  }}
                >
                  {escalationTriggers.map((t) => (
                    <div key={t.text} style={{ display: "flex", gap: 9 }}>
                      <span style={{ marginTop: 1 }}>
                        <CheckSquare on={t.on} />
                      </span>
                      <span>
                        {t.text}

                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Kicker>Never do this</Kicker>
                <div
                  style={{
                    marginTop: 11,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 12.5,
                  }}
                >
                  {neverDo.map((n) => (
                    <div key={n} style={{ display: "flex", gap: 9 }}>
                      <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>✗</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 11.5,
                    color: "var(--color-neutral-700)",
                    lineHeight: 1.45,
                  }}
                >
                  Breaches are blocked in-flight, logged with the transcript, and surfaced in Analytics.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Test console */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Test console
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                v11 → v12
              </span>
            </div>

            <input
              aria-label="Test the agent"
              placeholder="Replay a past call, or type what a customer might say…"
              style={{
                marginTop: 12,
                width: "100%",
                border: "1px solid var(--color-neutral-400)",
                background: "var(--color-surface)",
                padding: "11px 12px",
                fontSize: 12.5,
                fontFamily: "var(--font-body)",
                color: "var(--color-text)",
                borderRadius: 0,
              }}
            />

            <div
              style={{
                marginTop: 12,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Replay · Okonkwo, 3 Sep
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 12.5,
              }}
            >
              <div style={{ borderLeft: "3px solid var(--color-neutral-400)", paddingLeft: 10 }}>
                <b
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-neutral-700)",
                  }}
                >
                  v11 said
                </b>
                <div style={{ marginTop: 4, lineHeight: 1.45 }}>
                  &ldquo;I can apply £40 now and book a fixed morning slot for Thursday.&rdquo;
                </div>
              </div>
              <div style={{ borderLeft: "3px solid var(--color-accent)", paddingLeft: 10 }}>
                <b
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  v12 would say
                </b>
                <div style={{ marginTop: 4, lineHeight: 1.45 }}>
                  &ldquo;Because this is a third failure on a Premier promise, I&rsquo;m bringing a
                  manager in now and applying the £40 while you hold.&rdquo;
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--color-neutral-300)",
                display: "flex",
                flexDirection: "column",
                gap: 7,
                fontSize: 12,
              }}
            >
              {replayDelta.map((d) => (
                <DeltaRow key={d.label} label={d.label} from={d.from} to={d.to} hot={d.worse} />
              ))}
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
                  Est. saved escalations on Tier 1
                </span>
                <b style={{ color: "var(--color-neutral-800)" }}>+9%</b>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.45,
              }}
            >
              v12 escalates more and contains less — deliberately, on high-value accounts. Publish only
              if that trade is what you want.
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Version history</Kicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11, fontSize: 12 }}
            >
              {versionHistory.map((v, i) => (
                <div
                  key={v.version}
                  style={{
                    paddingBottom: i < versionHistory.length - 1 ? 10 : undefined,
                    borderBottom:
                      i < versionHistory.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b>{v.version}</b>
                    <span style={{ color: "var(--color-neutral-700)" }}>{v.by}</span>
                  </div>
                  <div style={{ marginTop: 3, color: "var(--color-neutral-800)" }}>{v.note}</div>
                </div>
              ))}
            </div>
            <LinkAction size={11} style={{ marginTop: 12, display: "block" }}>
              Roll back to a version →
            </LinkAction>
          </div>
        </div>
      </div>
    </section>
  );
}
