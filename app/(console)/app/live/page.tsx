import Link from "next/link";
import { Bar, Kicker, LinkAction, LiveDot, PrimaryButton } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { CallComposer } from "@/components/CallComposer";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getConsoleContext } from "@/lib/auth/context";
import { loadAgentConfig } from "@/lib/agent/config";
import { formatPence } from "@/lib/agent/authority";
import { getLiveCall } from "@/lib/queries/conversations";
import { normalise, type RawParams } from "@/lib/params";
import {
  releaseCall,
  resolveConversation,
  sendHumanReply,
  simulateCustomerMessage,
  stopAgent,
  takeOverCall,
} from "@/lib/actions/conversations";
import { approveHandoffDecision } from "@/lib/actions/handoffs";

export default async function LiveCallPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { session, brand } = await getConsoleContext();
  const params = normalise(await searchParams);
  const call = await getLiveCall(brand.id, params.call);

  if (!call) {
    return (
      <section style={{ padding: "20px 24px" }}>
        <h1 style={{ margin: 0, fontWeight: 800, fontSize: 30, letterSpacing: "-0.028em" }}>
          No call in progress
        </h1>
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "52ch" }}>
          When a customer reaches {brand.name} on any channel, the transcript streams here with the
          document behind every answer, and you can take the line at any point.
        </p>
      </section>
    );
  }

  const config = await loadAgentConfig(brand.id);
  const callerFacts = call.facts;
  const transcript = call.turns;
  const callActions = call.actions;
  const heldByYou = call.heldBy === session.name;
  const conversationId = call.conversation.id;

  // The sentiment strip below the transcript. One bar per turn that carried a
  // reading, so a flat call is visibly flat rather than a smoothed invention.
  const sentCurve = call.sentimentPoints.map((p) => ({
    h: `${Math.round(((p.value + 1) / 2) * 100)}%`,
    color: p.value < 0 ? "var(--color-accent)" : "var(--color-neutral-500)",
  }));

  // The entitlement rail is the live agent version's authority table, not a
  // copy of it — change a ceiling in Tuning and this moves.
  const entitlements = (config?.authority ?? []).map((a) => ({
    label: a.label,
    value: a.blocked
      ? "blocked"
      : a.ceilingPence === null
        ? "unlimited"
        : `up to ${formatPence(a.ceilingPence)}`,
    blocked: a.blocked,
  }));

  return (
    <section>
      {/* Call bar */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "var(--color-surface)",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-accent-700)",
          }}
        >
          <LiveDot size={8} />
          On call
        </span>
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}>{call.elapsed}</span>
        <LiveRefresh active={!call.ended} label="Following" />
        <span style={{ height: 26, width: 2, background: "var(--color-neutral-400)" }} />
        <Link
          href={call.customer ? `/app/customers/${call.customer.id}` : "/app/customers"}
          style={{ textAlign: "left", color: "var(--color-text)" }}
        >
          <b style={{ fontSize: 15 }}>{call.customer?.name ?? "Unidentified caller"}</b>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            {[call.customer?.phone, call.customer?.phone && "verified by number", call.customer?.tier]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "4px 8px",
          }}
        >
          Priority {call.priority ?? "—"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {call.heldBy && (
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)", marginRight: 4 }}>
              Held by <b style={{ color: "var(--color-text)" }}>{call.heldBy}</b>
            </span>
          )}
          {!call.ended && call.aiHolding && (
            <ActionButton
              variant="outline"
              pendingLabel="Stopping…"
              confirm="Stop the AI and queue a person? The customer is held with a status update."
              style={{ fontSize: 11.5, padding: "7px 11px", borderWidth: 1 }}
              action={async () => {
                "use server";
                await stopAgent(conversationId, "Stopped from the live console");
              }}
            >
              Stop the AI
            </ActionButton>
          )}
          {!call.ended && !call.aiHolding && heldByYou && (
            <ActionButton
              variant="outline"
              pendingLabel="Handing back…"
              style={{ fontSize: 11.5, padding: "7px 11px", borderWidth: 1 }}
              action={async () => {
                "use server";
                await releaseCall(conversationId);
              }}
            >
              Hand back to the AI
            </ActionButton>
          )}
          {!call.ended && (
            <ActionButton
              variant="outline"
              pendingLabel="Closing…"
              confirm="Mark this conversation resolved?"
              style={{ fontSize: 11.5, padding: "7px 11px", borderWidth: 1 }}
              action={async () => {
                "use server";
                await resolveConversation(conversationId, heldByYou ? "human_resolved" : "ai_resolved");
              }}
            >
              Resolve
            </ActionButton>
          )}
          {!call.ended && call.aiHolding ? (
            <ActionButton
              variant="primary"
              pendingLabel="Joining…"
              style={{ fontSize: 11.5, padding: "8px 13px" }}
              action={async () => {
                "use server";
                await takeOverCall(conversationId);
              }}
            >
              Take the line
            </ActionButton>
          ) : call.ended ? (
            <PrimaryButton href={`/app/conversations/${conversationId}`} style={{ fontSize: 11.5 }}>
              Open the record →
            </PrimaryButton>
          ) : null}
        </div>
      </div>

      {call.otherLive.length > 1 && (
        <div
          style={{
            padding: "8px 24px",
            borderBottom: "1px solid var(--color-neutral-300)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            overflowX: "auto",
          }}
        >
          <span style={{ color: "var(--color-neutral-700)", flexShrink: 0 }}>Also open</span>
          {call.otherLive.map((c) => {
            const current = c.id === conversationId;
            return (
              <Link
                key={c.id}
                href={`/app/live?call=${c.id}`}
                className={current ? undefined : "hov-border"}
                style={{
                  flexShrink: 0,
                  padding: "4px 9px",
                  fontWeight: 600,
                  border: `1px solid ${current ? "var(--color-text)" : "var(--color-neutral-400)"}`,
                  background: current ? "var(--color-text)" : "transparent",
                  color: current ? "var(--color-bg)" : "var(--color-text)",
                }}
              >
                {c.name}
                <span style={{ opacity: 0.7, marginLeft: 6 }}>
                  {c.waiting ? "waiting" : c.elapsed}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "268px 1fr 316px",
          minHeight: "calc(100vh - 52px - 63px)",
        }}
      >
        {/* Who is calling */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Who is calling</Kicker>
            <div
              style={{
                marginTop: 11,
                display: "flex",
                flexDirection: "column",
                gap: 7,
                fontSize: 12.5,
              }}
            >
              {callerFacts.map((f) => (
                <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "var(--color-neutral-800)" }}>{f.label}</span>
                  <b style={{ color: f.hot ? "var(--color-accent-700)" : undefined }}>{f.value}</b>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Open records</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}
            >
              {call.records.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Nothing mirrored from the tenant&rsquo;s systems for this customer.
                </span>
              )}
              {call.records.map((o) => (
                <div
                  key={o.id}
                  style={{
                    borderLeft: `3px solid ${o.urgent ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
                    paddingLeft: 9,
                  }}
                >
                  <b>{o.ref}</b>
                  <span style={{ display: "block", color: "var(--color-neutral-800)" }}>{o.line}</span>
                  <span
                    style={{
                      display: "block",
                      color: o.urgent ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                    }}
                  >
                    {o.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px" }}>
            <Kicker>Entitlements the AI may use</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}
            >
              {entitlements.map((e) => (
                <div key={e.label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--color-neutral-800)" }}>{e.label}</span>
                  <b style={{ color: e.blocked ? "var(--color-accent-700)" : undefined }}>{e.value}</b>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transcript */}
        <div
          style={{
            borderRight: "2px solid var(--color-divider)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "11px 20px",
              borderBottom: "1px solid var(--color-neutral-300)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Live transcript
            </span>
            <span style={{ flex: 1, fontSize: 11, color: "var(--color-neutral-700)" }}>
              {transcript.length} turn{transcript.length === 1 ? "" : "s"} ·{" "}
              {call.ungroundedTurns === 0
                ? "every AI answer is cited"
                : `${call.ungroundedTurns} AI answer${call.ungroundedTurns === 1 ? "" : "s"} with no document behind it`}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Sentiment</span>
            <Bar
              width={`${Math.round(((call.sentiment ?? 0) + 1) * 50)}%`}
              color={(call.sentiment ?? 0) < 0 ? "var(--color-accent)" : "var(--color-neutral-700)"}
              style={{ width: 84 }}
            />
            <b
              style={{
                fontSize: 11.5,
                color: (call.sentiment ?? 0) < 0 ? "var(--color-accent-700)" : "var(--color-neutral-800)",
              }}
            >
              {call.sentiment === null ? "—" : call.sentiment.toFixed(2)}
            </b>
          </div>

          <div
            style={{
              flex: 1,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 15,
            }}
          >
            {transcript.map((t) => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 14 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: t.isAi ? "var(--color-accent-700)" : "var(--color-neutral-500)",
                    paddingTop: 2,
                  }}
                >
                  {t.label}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{t.body}</div>
                  {t.citations.length > 0 && (
                    <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          background: "var(--color-accent-200)",
                          color: "var(--color-accent-800)",
                          padding: "4px 8px",
                        }}
                      >
                        {t.citations[0].cite}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          background: "var(--color-neutral-200)",
                          color: "var(--color-neutral-800)",
                          padding: "4px 8px",
                        }}
                      >
                        {t.citations[0].check}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {call.handoff && (
            <div
              style={{
                border: "2px solid var(--color-accent)",
                background: "var(--color-accent-100)",
                padding: "13px 15px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--color-accent-700)",
                  }}
                >
                  Guardrail stop
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-accent-800)" }}>
                  Trigger · {call.handoff?.reason}
                </span>
              </div>
              <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.5 }}>
                The AI has stopped negotiating and is holding the customer with a status update. A
                brief is written and waiting in the handoff queue.
              </div>
              <div style={{ marginTop: 11, display: "flex", alignItems: "flex-start", gap: 8 }}>
                {call.aiHolding && !call.ended && (
                  <ActionButton
                    variant="primary"
                    pendingLabel="Joining…"
                    style={{ fontSize: 11.5, padding: "9px 13px" }}
                    action={async () => {
                      "use server";
                      await takeOverCall(conversationId);
                    }}
                  >
                    Take the line now
                  </ActionButton>
                )}
                <Link
                  href={`/app/handoffs?handoff=${call.handoff.id}`}
                  className="hov-invert"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    border: "1px solid var(--color-text)",
                    padding: "8px 13px",
                    color: "var(--color-text)",
                  }}
                >
                  Read the brief
                </Link>
                {call.handoff.status !== "resolved" && (
                  <ActionButton
                    variant="outline"
                    pendingLabel="Approving…"
                    confirm="Approve the decision the AI refused? This is recorded against your name."
                    style={{ fontSize: 11.5, padding: "8px 13px", borderWidth: 1 }}
                    action={async () => {
                      "use server";
                      await approveHandoffDecision(call.handoff!.id, true);
                    }}
                  >
                    Approve the decision
                  </ActionButton>
                )}
              </div>
            </div>
            )}
          </div>

          <CallComposer
            conversationId={conversationId}
            aiHolding={call.aiHolding}
            heldByYou={heldByYou}
            ended={call.ended}
            onCustomerMessage={simulateCustomerMessage}
            onHumanReply={sendHumanReply}
          />
        </div>

        {/* Documents and actions */}
        <div>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Documents in play</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}
            >
              {call.documentsInPlay.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Nothing retrieved yet. Documents appear here the moment the agent leans on one.
                </span>
              )}
              {call.documentsInPlay.map((d) => (
                <div
                  key={d.title}
                  style={{
                    border: "1px solid var(--color-neutral-400)",
                    background: "var(--color-surface)",
                    padding: "9px 10px",
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <b style={{ flex: 1 }}>{d.title}</b>
                    <span
                      style={{
                        color: d.strong ? "var(--color-accent-700)" : "var(--color-neutral-700)",
                        fontWeight: 700,
                      }}
                    >
                      {d.confidence}
                    </span>
                  </div>
                  <div style={{ color: "var(--color-neutral-700)", marginTop: 3 }}>{d.note}</div>
                </div>
              ))}
              {call.topGap && (
                <div
                  style={{
                    border: "1px dashed var(--color-neutral-400)",
                    padding: "9px 10px",
                    color: "var(--color-neutral-700)",
                  }}
                >
                  No document covers{" "}
                  <b style={{ color: "var(--color-text)" }}>{call.topGap.intent.toLowerCase()}</b> —
                  asked {call.topGap.hits} time{call.topGap.hits === 1 ? "" : "s"}.{" "}
                  <LinkAction href={`/app/knowledge?gap=${call.topGap.id}`} size={12}>
                    Draft one
                  </LinkAction>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker>Actions taken this call</Kicker>
            <div
              style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}
            >
              {callActions.map((a) => (
                <div key={`${a.at}-${a.label}`} style={{ display: "flex", gap: 8 }}>
                  <b style={{ color: "var(--color-neutral-700)", width: 40 }}>{a.at}</b>
                  <span style={{ flex: 1, color: a.allowed ? undefined : "var(--color-accent-700)" }}>
                    {a.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 18px" }}>
            <Kicker>Sentiment across the call</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                height: 62,
                borderBottom: "1px solid var(--color-neutral-400)",
              }}
            >
              {sentCurve.length === 0 ? (
                <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)", alignSelf: "center" }}>
                  No sentiment readings on this conversation yet.
                </span>
              ) : (
                sentCurve.map((p, i) => (
                  <span key={i} style={{ flex: 1, display: "block", background: p.color, height: p.h }} />
                ))
              )}
            </div>
            {sentCurve.length > 0 && (
              <div
                style={{
                  marginTop: 7,
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10.5,
                  color: "var(--color-neutral-700)",
                }}
              >
                <span>start</span>
                <span>
                  {sentCurve.length} reading{sentCurve.length === 1 ? "" : "s"}
                </span>
                <span>{call.elapsed}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
