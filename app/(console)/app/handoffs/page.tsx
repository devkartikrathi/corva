import { Kicker, LinkAction, OutlineButton, PrimaryButton, ScreenHeader, Tag } from "@/components/ui";
import { notFound } from "next/navigation";
import { getConsoleContext } from "@/lib/auth/context";
import { getHandoffTranscript, listHandoffs } from "@/lib/queries/conversations";
import { acceptHandoff, approveHandoffDecision } from "@/lib/actions/handoffs";
import { ActionButton } from "@/components/ActionButton";

type Brief = {
  wants?: string;
  alreadyDid?: { ok: boolean; text: string }[];
  decision?: string;
  decisionContext?: string;
  openingLine?: string;
  sensitivities?: string;
};

export default async function HandoffsPage() {
  const { brand } = await getConsoleContext();
  const handoffs = await listHandoffs(brand.id);

  if (handoffs.length === 0) {
    return (
      <section>
        <ScreenHeader
          kicker="Nothing waiting"
          title="Handoffs"
          lede="When the AI reaches a limit it writes a brief and queues it here. Nothing is waiting for a person right now."
        />
      </section>
    );
  }

  // The queue is worked oldest-first, so the top of it is what is open.
  const selected = handoffs[0];
  const brief = (selected.brief ?? {}) as Brief;
  const briefTranscript = await getHandoffTranscript(selected.conversationId);
  const briefDidAlready = brief.alreadyDid ?? [];

  return (
    <section>
      <ScreenHeader
        kicker={`${handoffs.length} waiting · oldest ${handoffs[0].wait}`}
        title="Handoffs"
        lede="Every handoff arrives with a written brief. No customer is asked to explain themselves twice."
      >
        <OutlineButton>Round-robin: on</OutlineButton>
        <PrimaryButton>Take next</PrimaryButton>
      </ScreenHeader>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* Queue */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {handoffs.map((h) => (
            <button
              key={h.id}
              type="button"
              className="hov-raise"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "13px 18px",
                borderBottom: "1px solid var(--color-neutral-300)",
                borderLeft: `3px solid ${h.edge}`,
                background: h.id === selected.id ? "var(--color-surface)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ fontSize: 13 }}>{h.name}</b>
                <span
                  style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: h.waitColor }}
                >
                  {h.wait}
                </span>
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 12,
                  color: "var(--color-neutral-800)",
                  lineHeight: 1.4,
                }}
              >
                {h.reason}
              </div>
              <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center" }}>
                <Tag bg={h.tagBg} fg={h.tagFg} padding="3px 6px">
                  {h.channel}
                </Tag>
                <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                  P{h.priority} · {h.value}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Brief */}
        <div>
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "2px solid var(--color-divider)",
              background: "var(--color-surface)",
              display: "flex",
              alignItems: "flex-start",
              gap: 20,
            }}
          >
            <div style={{ flex: 1 }}>
              <Kicker color="var(--color-accent-700)">Brief · written by the AI</Kicker>
              <h2
                style={{
                  margin: "8px 0 0",
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: "-0.022em",
                }}
              >
                {selected.name} · {selected.reason}
              </h2>
              <div style={{ marginTop: 7, fontSize: 12.5, color: "var(--color-neutral-800)" }}>
                Waiting {selected.wait} · Priority {selected.priority} · {selected.value} lifetime value
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton
                action={async () => {
                  "use server";
                  await acceptHandoff(selected.id);
                }}
                pendingLabel="Taking…"
              >
                Accept &amp; take the line
              </ActionButton>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              borderBottom: "2px solid var(--color-divider)",
            }}
          >
            <div style={{ padding: "18px 24px", borderRight: "1px solid var(--color-neutral-300)" }}>
              <Kicker>What the customer wants</Kicker>
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--color-text)",
                }}
              >
                {brief.wants ?? "—"}
              </p>

              <Kicker style={{ marginTop: 16 }}>What the AI already did</Kicker>
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  fontSize: 12.5,
                }}
              >
                {briefDidAlready.map((d) => (
                  <div key={d.text} style={{ display: "flex", gap: 9 }}>
                    <span
                      style={{
                        color: d.ok ? "var(--color-accent)" : "var(--color-neutral-700)",
                        fontWeight: 700,
                      }}
                    >
                      {d.ok ? "✓" : "✗"}
                    </span>
                    <span>{d.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "18px 24px" }}>
              <Kicker>The one decision left</Kicker>
              <div style={{ marginTop: 10, border: "2px solid var(--color-text)", padding: "13px 15px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{brief.decision ?? "—"}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12.5,
                    color: "var(--color-neutral-800)",
                    lineHeight: 1.5,
                  }}
                >
                  {brief.decisionContext ?? "—"}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <ActionButton
                    action={async () => {
                      "use server";
                      await approveHandoffDecision(selected.id, true);
                    }}
                    pendingLabel="Approving…"
                    style={{ fontSize: 11.5, padding: "9px 12px" }}
                  >
                    Approve
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    action={async () => {
                      "use server";
                      await approveHandoffDecision(selected.id, false);
                    }}
                    pendingLabel="Declining…"
                    confirm="Decline this decision and close the handoff?"
                    style={{ fontSize: 11.5, padding: "8px 12px", border: "1px solid var(--color-text)" }}
                  >
                    Decline
                  </ActionButton>
                </div>
              </div>

              <Kicker style={{ marginTop: 16 }}>Suggested opening line</Kicker>
              <p
                style={{
                  margin: "10px 0 0",
                  padding: "12px 14px",
                  background: "var(--color-surface)",
                  borderLeft: "3px solid var(--color-text)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--color-text)",
                }}
              >
                &ldquo;{brief.openingLine}&rdquo;
              </p>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 11.5,
                  color: "var(--color-neutral-700)",
                  lineHeight: 1.45,
                }}
              >
                Known sensitivities: {brief.sensitivities ?? "none recorded"}
              </div>
            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <Kicker>Transcript so far</Kicker>
              <LinkAction href="/app/live" style={{ marginLeft: "auto" }}>
                Open the live console →
              </LinkAction>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 11,
                maxWidth: 900,
              }}
            >
              {briefTranscript.map((t) => (
                <div key={t.label} style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: 12 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: t.ai ? "var(--color-accent-700)" : "var(--color-neutral-500)",
                    }}
                  >
                    {t.label}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.5 }}>{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
