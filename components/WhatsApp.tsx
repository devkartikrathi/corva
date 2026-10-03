"use client";

import { useState, useTransition } from "react";

/**
 * Connecting a WhatsApp number, and the two values Meta has to be given back.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const input = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
  width: "100%",
} as const;
const label = { fontSize: 11, fontWeight: 700, color: "var(--color-neutral-700)", display: "block", marginBottom: 4 } as const;
const small = { fontSize: 11.5, fontWeight: 700, padding: "7px 11px", border: "1px solid var(--color-neutral-400)", cursor: "pointer" } as const;
const primary = { fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "8px 13px", cursor: "pointer" } as const;

export function ConnectWhatsApp({
  ready,
  onConnect,
}: {
  ready: boolean;
  onConnect: (input: { phoneNumberId: string; token: string; appSecret: string }) => Promise<Result<{ number: string }>>;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div style={{ border: "1px solid var(--color-neutral-400)", padding: "16px 18px", maxWidth: 760, display: "grid", gap: 12 }}>
      <div>
        <label style={label} htmlFor="wa-id">
          Phone number ID
        </label>
        <input id="wa-id" style={input} value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="e.g. 109876543210987" inputMode="numeric" autoComplete="off" />
      </div>
      <div>
        <label style={label} htmlFor="wa-token">
          Access token (a permanent one, from a system user)
        </label>
        <input id="wa-token" type="password" style={input} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label style={label} htmlFor="wa-secret">
          App secret
        </label>
        <input id="wa-secret" type="password" style={input} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <button
          type="button"
          className="hov-accent"
          style={{ ...primary, opacity: pending || !ready ? 0.6 : 1 }}
          disabled={pending || !ready || !phoneNumberId.trim() || !token.trim() || !appSecret.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const result = await onConnect({ phoneNumberId, token, appSecret });
                if (!result.ok) setError(result.error);
              } catch {
                setError("That did not work. Try again in a moment.");
              }
            })
          }
        >
          {pending ? "Checking with WhatsApp…" : "Connect number"}
        </button>
      </div>
      {!ready && (
        <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
          Connecting WhatsApp is not switched on for this deployment yet (DATA_SOURCE_KEY is not set).
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <code style={{ flex: 1, fontSize: 11.5, wordBreak: "break-all", border: "1px solid var(--color-neutral-300)", padding: "6px 8px", background: "var(--color-surface)" }}>{value}</code>
      <button
        type="button"
        className="hov-invert"
        style={small}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export function DisconnectWhatsApp({ onDisconnect }: { onDisconnect: () => Promise<Result<void>> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="hov-invert"
      style={{ ...small, opacity: pending ? 0.6 : 1 }}
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Disconnect this WhatsApp number? The assistant stops answering on it. Past conversations stay.")) return;
        start(() => onDisconnect().then(() => {}));
      }}
    >
      Disconnect
    </button>
  );
}

/**
 * The template Meta approved for writing first. WhatsApp lets a business
 * message a customer who has not written in 24 hours only with one of these.
 */
export function OpeningTemplate({
  current,
  onSave,
}: {
  current: { name: string; language: string; nameParam: boolean } | null;
  onSave: (t: { name: string; language: string; nameParam: boolean } | null) => Promise<{ ok: true; value: { saved: boolean } } | { ok: false; error: string }>;
}) {
  const [t, setT] = useState(current ?? { name: "", language: "en", nameParam: true });
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = { border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0 } as const;
  const save = (value: typeof t | null) =>
    start(async () => {
      const r = await onSave(value);
      setNote(r.ok ? (value ? "Saved." : "Removed.") : r.error);
    });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Template name, e.g. follow_up" aria-label="Template name" style={{ ...field, width: 220 }} />
      <input value={t.language} onChange={(e) => setT({ ...t, language: e.target.value })} placeholder="en" aria-label="Language code" style={{ ...field, width: 70 }} />
      <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <input type="checkbox" checked={t.nameParam} onChange={(e) => setT({ ...t, nameParam: e.target.checked })} />
        {"{{1}}"} is the customer&rsquo;s first name
      </label>
      <button type="button" disabled={pending || !t.name.trim()} onClick={() => save(t)} style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px" }}>
        Save
      </button>
      {current && (
        <button type="button" disabled={pending} onClick={() => save(null)} style={{ fontSize: 11, fontWeight: 700, border: "1px solid var(--color-neutral-400)", padding: "5px 9px" }}>
          Remove
        </button>
      )}
      {note && <span style={{ fontSize: 12 }}>{note}</span>}
    </div>
  );
}
