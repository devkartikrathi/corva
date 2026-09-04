import Link from "next/link";
import { Kicker, LinkAction, ScreenHeader, Tag } from "@/components/ui";
import { Tab, TabStrip } from "@/components/filters";
import { getConsoleContext } from "@/lib/auth/context";
import { handoffCounts, getHandoffTranscript, listHandoffs } from "@/lib/queries/conversations";
import { acceptHandoff, approveHandoffDecision, reassignHandoff } from "@/lib/actions/handoffs";
import { getTeam } from "@/lib/queries/workspace";
import { href, normalise, type RawParams } from "@/lib/params";
import { ActionButton } from "@/components/ActionButton";
import { ReassignPicker } from "@/components/ReassignPicker";

const PATH = "/app/handoffs";
const TABS = [
  { key: "waiting", label: "Waiting" },
  { key: "accepted", label: "Being handled" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "Everything" },
] as const;

type Brief = {
  wants?: string;
  alreadyDid?: { ok: boolean; text: string }[];
  decision?: string;
  decisionContext?: string;
  openingLine?: string;
  sensitivities?: string;
};

export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { session, brand } = await getConsoleContext();
  const params = normalise(await searchParams);
  const status = (TABS.find((t) => t.key === params.status)?.key ?? "waiting") as
    | "waiting"
    | "accepted"
    | "resolved"
    | "all";

  const [handoffs, counts, team] = await Promise.all([
    listHandoffs(brand.id, status),
    handoffCounts(brand.id),
    getTeam(session.orgId),
  ]);

  const tabs = (
    <TabStrip>
      {TABS.map((t) => (
        <Tab
          key={t.key}
          label={t.label}
          href={href(PATH, params, { status: t.key === "waiting" ? null : t.key, handoff: null })}
          current={status === t.key}
          count={counts[t.key]}
        />
      ))}
    </TabStrip>
  );

  if (handoffs.length === 0) {
    return (
      <section>
        <ScreenHeader
          kicker={counts.waiting === 0 ? "Nothing waiting" : `${counts.waiting} waiting`}
          title="Handoffs"
          lede="When the AI reaches a limit it writes a brief and queues it here. Nothing matches this filter right now."
        />
        {tabs}
      </section>
    );
  }

  // The queue is worked most-urgent-first, so the top of it is what opens —
  // unless the URL names one, which is how a link from the command centre or
  // the live console lands on the right brief.
  const selected = handoffs.find((h) => h.id === params.handoff) ?? handoffs[0];
  const brief = (selected.brief ?? {}) as Brief;
  const briefTranscript = await getHandoffTranscript(selected.conversationId);
  const briefDidAlready = brief.alreadyDid ?? [];

  return (
    <section>
      <ScreenHeader
        kicker={
          status === "waiting"
            ? `${counts.waiting} waiting · oldest ${handoffs[0].wait}`
            : `${handoffs.length} ${TABS.find((t) => t.key === status)!.label.toLowerCase()}`
        }
        title="Handoffs"
        lede="Every handoff arrives with a written brief. No customer is asked to explain themselves twice."
        border={false}
      >
        {counts.waiting > 0 && (
          <ActionButton
            variant="primary"
            pendingLabel="Taking…"
            action={async () => {
              "use server";
              await acceptHandoff(handoffs[0].id);
            }}
          >
            Take next · {handoffs[0].name}
          </ActionButton>
        )}
      </ScreenHeader>
      {tabs}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* Queue */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          {handoffs.map((h) => (
            <Link
              key={h.id}
              href={href(PATH, params, { handoff: h.id })}
              className="hov-raise"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "13px 18px",
                borderBottom: "1px solid var(--color-neutral-300)",
                borderLeft: `3px solid ${h.edge}`,
                background: h.id === selected.id ? "var(--color-surface)" : "transparent",
                color: "var(--color-text)",
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
                {h.acceptedBy && (
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                    {h.acceptedBy}
                  </span>
                )}
              </div>
            </Link>
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
                {selected.status === "waiting"
                  ? `Waiting ${selected.wait}`
                  : selected.acceptedBy
                    ? `With ${selected.acceptedBy}`
                    : selected.status}
                {" · "}Priority {selected.priority} · {selected.value} lifetime value
                {selected.resolution && ` · ${selected.resolution}`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <LinkAction href={`/app/live?call=${selected.conversationId}`} size={12}>
                Open the conversation →
              </LinkAction>
              <ReassignPicker
                handoffId={selected.id}
                current={selected.acceptedBy}
                options={team.people.map((p) => ({ id: p.membershipId, name: p.name, role: p.role }))}
                onReassign={reassignHandoff}
              />
              {selected.status === "waiting" && (
                <ActionButton
                  action={async () => {
                    "use server";
                    await acceptHandoff(selected.id);
                  }}
                  pendingLabel="Taking…"
                >
                  Accept &amp; take the line
                </ActionButton>
              )}
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
