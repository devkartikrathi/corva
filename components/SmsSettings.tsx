"use client";

import { useState, useTransition } from "react";

type Purpose = { key: string; label: string; body: string; slots: readonly string[] };
type Template = { purpose: string; body: string; dltTemplateId: string; providerTemplateId: string; enabled: boolean };
type Message = { id: string; to: string; purpose: string; body: string; status: string; error: string | null; at: string };

const input = { border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0, minWidth: 0 } as const;
const small = { fontSize: 11, fontWeight: 700, border: "1px solid var(--color-neutral-400)", padding: "5px 9px", cursor: "pointer", background: "var(--color-bg)" } as const;
const primary = { fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px", cursor: "pointer" } as const;

const errorText = (e: unknown) => (e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");

/**
 * SMS for this business: who sends it, and the approved template for each
 * purpose. In India every SMS must match a template approved on DLT, so the
 * words here are exactly the approved ones with `{#var#}` where a value goes.
 */
export function SmsSettings({
  current,
  purposes,
  templates,
  messages,
  onSave,
  onSaveTemplate,
  onTest,
}: {
  current: { provider: string; enabled: boolean; senderId: string; dltEntityId: string; hasCredentials: boolean };
  purposes: readonly Purpose[];
  templates: Template[];
  messages: Message[];
  onSave: (input: { provider: string; enabled: boolean; senderId: string; dltEntityId: string; credentials: Record<string, string> | null }) => Promise<void>;
  onSaveTemplate: (input: Template) => Promise<void>;
  onTest: (purpose: string, to: string) => Promise<{ status: string; body: string }>;
}) {
  const [form, setForm] = useState({ provider: current.provider, enabled: current.enabled, senderId: current.senderId, dltEntityId: current.dltEntityId });
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [test, setTest] = useState({ purpose: purposes[0]?.key ?? "", to: "" });

  const run = (fn: () => Promise<string | void>) => {
    setError(null);
    setNote(null);
    start(async () => {
      try {
        const done = await fn();
        if (done) setNote(done);
      } catch (e) {
        setError(errorText(e));
      }
    });
  };

  const credFields = form.provider === "msg91" ? [["authKey", "MSG91 auth key"]] : form.provider === "twilio" ? [["accountSid", "Account SID"], ["authToken", "Auth token"]] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
      <div className="m-wrap" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} aria-label="SMS provider" style={input}>
          <option value="log">Test only — send nothing, keep a log</option>
          <option value="msg91">MSG91 (India, DLT)</option>
          <option value="twilio">Twilio (outside India)</option>
        </select>
        <input value={form.senderId} onChange={(e) => setForm({ ...form, senderId: e.target.value })} placeholder={form.provider === "twilio" ? "From number / MG…" : "Sender id, e.g. TMBLDY"} aria-label="Sender id" style={{ ...input, width: 170 }} />
        {form.provider !== "twilio" && (
          <input value={form.dltEntityId} onChange={(e) => setForm({ ...form, dltEntityId: e.target.value })} placeholder="DLT entity id" aria-label="DLT entity id" style={{ ...input, width: 170 }} />
        )}
        {credFields.map(([key, label]) => (
          <input
            key={key}
            type="password"
            autoComplete="off"
            value={creds[key] ?? ""}
            onChange={(e) => setCreds({ ...creds, [key]: e.target.value })}
            placeholder={current.hasCredentials ? `${label} (saved — type to replace)` : label}
            aria-label={label}
            style={{ ...input, width: 220 }}
          />
        ))}
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Send SMS
        </label>
        <button
          type="button"
          disabled={pending}
          className="hov-accent"
          style={primary}
          onClick={() =>
            run(async () => {
              await onSave({ ...form, credentials: credFields.some(([k]) => creds[k]?.trim()) ? creds : null });
              setCreds({});
              return "Saved.";
            })
          }
        >
          Save
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {purposes.map((p) => (
          <TemplateRow key={p.key} purpose={p} saved={templates.find((t) => t.purpose === p.key)} onSave={onSaveTemplate} />
        ))}
      </div>

      <div className="m-wrap" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--color-neutral-300)" }}>
        <b style={{ fontSize: 12 }}>Try it:</b>
        <select value={test.purpose} onChange={(e) => setTest({ ...test, purpose: e.target.value })} aria-label="Which message" style={input}>
          {purposes.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <input value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} placeholder="Your mobile number" inputMode="tel" aria-label="Send the test to" style={{ ...input, width: 170 }} />
        <button type="button" disabled={pending || !test.to.trim()} style={small} onClick={() => run(async () => {
          const r = await onTest(test.purpose, test.to);
          return `${r.status === "logged" ? "Logged (test mode, not sent)" : "Sent"}: “${r.body}”`;
        })}>
          Send a test
        </button>
      </div>

      {note && <span style={{ fontSize: 12 }}>{note}</span>}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}

      {messages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5 }}>
          <b style={{ fontSize: 11 }}>Recent</b>
          {messages.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 8, color: "var(--color-neutral-800)" }}>
              <span style={{ width: 110, flexShrink: 0, color: "var(--color-neutral-700)" }}>{m.at}</span>
              <span style={{ width: 120, flexShrink: 0 }}>{m.to}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.body}>
                {m.body}
              </span>
              <b style={{ color: m.status === "failed" ? "var(--color-accent-700)" : undefined }} title={m.error ?? undefined}>
                {m.status}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateRow({ purpose, saved, onSave }: { purpose: Purpose; saved?: Template; onSave: (t: Template) => Promise<void> }) {
  const [t, setT] = useState<Template>(saved ?? { purpose: purpose.key, body: purpose.body, dltTemplateId: "", providerTemplateId: "", enabled: false });
  const [state, setState] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div style={{ border: "1px solid var(--color-neutral-300)", padding: "8px 10px", background: "var(--color-bg)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontWeight: 700 }}>
          <input type="checkbox" checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} />
          {purpose.label}
        </label>
        <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>slots, in order: {purpose.slots.join(" · ")}</span>
      </div>
      <textarea value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} rows={2} aria-label={`${purpose.label} template`} style={{ ...input, width: "100%", marginTop: 6, resize: "vertical" }} />
      <div className="m-wrap" style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input value={t.dltTemplateId} onChange={(e) => setT({ ...t, dltTemplateId: e.target.value })} placeholder="DLT template id" aria-label="DLT template id" style={{ ...input, width: 180 }} />
        <input value={t.providerTemplateId} onChange={(e) => setT({ ...t, providerTemplateId: e.target.value })} placeholder="MSG91 template id" aria-label="Provider template id" style={{ ...input, width: 180 }} />
        <button
          type="button"
          disabled={pending}
          style={small}
          onClick={() =>
            start(async () => {
              setState(null);
              try {
                await onSave(t);
                setState("Saved");
              } catch (e) {
                setState(errorText(e));
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state && <span style={{ fontSize: 11.5, color: state === "Saved" ? undefined : "var(--color-accent-700)" }}>{state}</span>}
      </div>
    </div>
  );
}
