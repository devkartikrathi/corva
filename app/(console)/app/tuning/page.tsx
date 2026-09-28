import { DeltaRow, Kicker, ScreenRefusal, ScreenTitle, Th } from "@/components/ui";
import { notFound } from "next/navigation";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import {
  AuthorityCell,
  NeverRules,
  PersonaEditor,
  TestConsole,
  ToneDial,
} from "@/components/tuning-controls";
import { ActionToggle } from "@/components/ActionButton";
import {
  addNeverRule,
  discardDraft,
  previewReply,
  removeNeverRule,
  rollbackToVersion,
  setAuthority,
  setPersona,
  setTone,
  toggleTrigger,
} from "@/lib/actions/workspace";

/** The dial ends, phrased the way the design phrased them. */
const TONE_ENDS: Record<string, [string, string]> = {
  warmth: ["clinical", "effusive"],
  brevity: ["thorough", "terse"],
  formality: ["casual", "formal"],
  persistence: ["hands over early", "keeps trying"],
};

const SECTIONS = [
  { id: "persona", name: "Persona & tone" },
  { id: "authority", name: "What it may do" },
  { id: "guardrails", name: "Guardrails" },
  { id: "history", name: "Version history" },
];
import { getTuning } from "@/lib/queries/workspace";
import { publishAgentVersion } from "@/lib/actions/workspace";
import { ActionButton } from "@/components/ActionButton";

export default async function TuningPage() {
  const { brand, denied } = await guardScreen("agent.edit");
  // The nav withholds this screen; this is what makes withholding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="AI tuning"
        reason={refusalReason(denied)}
        next="What the AI was told to do shows on every call in the archive."
      />
    );
  }

  const tuning = await getTuning(brand.id);
  if (!tuning) notFound();

  const {
    live,
    draft,
    versions,
    persona: PERSONA,
    toneRaw,
    authority,
    triggers: escalationTriggers,
    neverRules: neverDo,
    diff,
    editingDraft,
  } = tuning;

  const versionHistory = versions
    .filter((v) => v.status !== "draft")
    .map((v) => ({
      id: v.id,
      status: v.status,
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
          {draft && (
            <ActionButton
              variant="outline"
              pendingLabel="Discarding…"
              confirm={`Discard v${draft.version}? Every unpublished change is lost.`}
              action={async () => {
                "use server";
                await discardDraft();
              }}
            >
              Discard draft
            </ActionButton>
          )}
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
            <span
              style={{
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                alignSelf: "center",
                maxWidth: "26ch",
                lineHeight: 1.4,
              }}
            >
              No draft. Editing anything below forks one from v{live?.version} automatically.
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 340px" }}>
        {/* Section nav */}
        <div style={{ borderRight: "2px solid var(--color-divider)", padding: "14px 0" }}>
          {SECTIONS.map((t, i) => (
            <a
              key={t.name}
              href={`#${t.id}`}
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
                color: "var(--color-text)",
              }}
            >
              <span
                style={{
                  width: 3,
                  height: 14,
                  display: "block",
                  background: i === 0 ? "var(--color-accent)" : "transparent",
                }}
              />
              <span style={{ flex: 1 }}>{t.name}</span>
            </a>
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
              <PersonaEditor persona={PERSONA} onSave={setPersona} />
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "16px 28px",
              }}
            >
              {Object.entries(toneRaw).map(([key, value]) => (
                <ToneDial
                  key={key}
                  label={key[0].toUpperCase() + key.slice(1)}
                  value={value}
                  low={TONE_ENDS[key]?.[0] ?? ""}
                  high={TONE_ENDS[key]?.[1] ?? ""}
                  onChange={async (next) => {
                    "use server";
                    await setTone(key, next);
                  }}
                />
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
                  <Th width={170} padding="7px 10px">Ceiling</Th>
                  <Th width={140} padding="7px 10px">Above that</Th>
                </tr>
              </thead>
              <tbody>
                {authority.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                    <td style={{ padding: "9px 0" }}>
                      <b>{a.action}</b>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <AuthorityCell
                        row={{
                          id: a.id,
                          action: a.key,
                          blocked: a.blocked,
                          ceilingPaise: a.ceilingPaise,
                          escalateTo: a.escalateTo,
                        }}
                        onSave={setAuthority}
                      />
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--color-neutral-800)" }}>
                      {a.escalate}
                    </td>
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
                    <div key={t.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <span style={{ marginTop: 1 }}>
                        <ActionToggle
                          on={t.on}
                          label={t.text}
                          action={async (next) => {
                            "use server";
                            await toggleTrigger(t.id, next);
                          }}
                        />
                      </span>
                      <span style={{ flex: 1, opacity: t.on ? 1 : 0.55 }}>{t.text}</span>
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
                  <NeverRules rules={neverDo} onAdd={addNeverRule} onRemove={removeNeverRule} />
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
                {editingDraft && draft ? `draft v${draft.version}` : `live v${live?.version}`}
              </span>
            </div>

            <TestConsole
              version={editingDraft && draft ? draft.version : (live?.version ?? 0)}
              onAsk={previewReply}
            />

            <p
              style={{
                marginTop: 14,
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.45,
              }}
            >
              The test runs the same retrieval, the same triggers and the same system prompt a real
              turn runs. Nothing is written — no turn, no citation, no knowledge gap — so testing
              cannot move the numbers on the other screens.
            </p>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker color="var(--color-accent-700)">
              {draft ? `What publishing v${draft.version} changes` : "Nothing staged"}
            </Kicker>
            {!draft ? (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "var(--color-neutral-700)",
                  lineHeight: 1.45,
                }}
              >
                v{live?.version} is answering calls and there is no draft. Change a dial, a ceiling
                or a guardrail and a draft is forked from it — the live version is never edited in
                place.
              </p>
            ) : diff.length === 0 ? (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "var(--color-neutral-700)",
                  lineHeight: 1.45,
                }}
              >
                v{draft.version} is identical to v{live?.version} so far. Every row that differs
                appears here as you change it.
              </p>
            ) : (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  fontSize: 12,
                }}
              >
                {diff.map((d, i) => (
                  <DeltaRow key={`${d.label}-${i}`} label={d.label} from={d.from} to={d.to} hot />
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Version history</Kicker>
            <div
              style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 11, fontSize: 12 }}
            >
              {versionHistory.map((v, i) => (
                <div
                  key={v.id}
                  style={{
                    paddingBottom: i < versionHistory.length - 1 ? 10 : undefined,
                    borderBottom:
                      i < versionHistory.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <b>{v.version}</b>
                    {v.status === "live" && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--color-accent-700)",
                        }}
                      >
                        Live
                      </span>
                    )}
                    <span style={{ color: "var(--color-neutral-700)" }}>{v.by}</span>
                    {v.status !== "live" && (
                      <span style={{ marginLeft: "auto" }}>
                        <ActionButton
                          variant="hairline"
                          pendingLabel="Drafting…"
                          confirm={`Roll back to ${v.version}? It is copied forward as a new draft for you to publish.`}
                          style={{ fontSize: 10.5, padding: "3px 7px" }}
                          action={async () => {
                            "use server";
                            await rollbackToVersion(v.id);
                          }}
                        >
                          Roll back
                        </ActionButton>
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 3, color: "var(--color-neutral-800)" }}>{v.note}</div>
                </div>
              ))}
            </div>
            <p
              style={{
                marginTop: 12,
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.45,
              }}
            >
              A rollback copies the old version forward as a draft rather than making it live again,
              so &ldquo;which version answered this call&rdquo; always has one answer.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
