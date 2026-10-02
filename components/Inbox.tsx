"use client";

import { useState, useTransition } from "react";

/**
 * Connecting the business's inbox, and asking for it to be read now.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type Provider = { key: string; label: string; host: string; help: string };

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

export function ConnectInbox({
  ready,
  providers,
  onConnect,
}: {
  ready: boolean;
  providers: Provider[];
  onConnect: (input: { address: string; password: string; host: string }) => Promise<Result<{ address: string; kept: number; looked: number }>>;
}) {
  const [provider, setProvider] = useState(providers[0].key);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = providers.find((p) => p.key === provider) ?? providers[0];

  return (
    <div style={{ border: "1px solid var(--color-neutral-400)", padding: "16px 18px", maxWidth: 760 }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label style={label} htmlFor="mb-provider">
            Where the mailbox is
          </label>
          <select id="mb-provider" style={input} value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {!chosen.host && (
          <div>
            <label style={label} htmlFor="mb-host">
              Mail server (IMAP)
            </label>
            <input id="mb-host" style={input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.yourprovider.com" />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label} htmlFor="mb-address">
              Email address customers write to
            </label>
            <input id="mb-address" type="email" autoComplete="off" style={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="hello@yourbusiness.com" />
          </div>
          <div>
            <label style={label} htmlFor="mb-password">
              Password or app password
            </label>
            <input id="mb-password" type="password" autoComplete="new-password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>{chosen.help}</div>
        <div>
          <button
            type="button"
            className="hov-accent"
            style={{ ...primary, opacity: pending || !ready ? 0.6 : 1 }}
            disabled={pending || !ready || !address.trim() || !password}
            onClick={() =>
              start(async () => {
                setError(null);
                try {
                  const result = await onConnect({ address, password, host: chosen.host || host });
                  if (!result.ok) setError(result.error);
                  else setPassword("");
                } catch {
                  setError("That did not work. Try again in a moment.");
                }
              })
            }
          >
            {pending ? "Connecting and reading the last two weeks…" : "Connect inbox"}
          </button>
        </div>
        {!ready && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
            Connecting an inbox is not switched on for this deployment yet (DATA_SOURCE_KEY is not set).
          </div>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export function InboxControls({
  canManage,
  onCheck,
  onDisconnect,
}: {
  canManage: boolean;
  onCheck: () => Promise<Result<{ looked: number; kept: number }>>;
  onDisconnect: () => Promise<Result<void>>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = <T,>(work: () => Promise<Result<T>>, done: (value: T) => string | null) =>
    start(async () => {
      setNote(null);
      try {
        const result = await work();
        setNote(result.ok ? done(result.value) : result.error);
      } catch {
        setNote("That did not work. Try again in a moment.");
      }
    });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {note && <span style={{ fontSize: 11.5, color: "var(--color-neutral-800)" }}>{note}</span>}
      <button
        type="button"
        className="hov-invert"
        style={{ ...small, opacity: pending ? 0.6 : 1 }}
        disabled={pending}
        onClick={() => run(onCheck, (v) => (v.looked ? `Read ${v.looked} new ${v.looked === 1 ? "message" : "messages"}; ${v.kept} from customers.` : "Nothing new."))}
      >
        {pending ? "Reading…" : "Check now"}
      </button>
      {canManage && (
        <button
          type="button"
          className="hov-invert"
          style={small}
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Stop reading this inbox? Conversations already recorded stay on their customers.")) return;
            run(onDisconnect, () => null);
          }}
        >
          Disconnect
        </button>
      )}
    </span>
  );
}
