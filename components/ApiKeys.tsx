"use client";

import { useState, useTransition } from "react";

/**
 * The keys a business's own systems use to reach Corva.
 *
 * A new key is shown once, with a copy button, and then only by its first
 * characters — the list is for telling keys apart and revoking the right one.
 */
export function ApiKeys({
  keys,
  onCreate,
  onRevoke,
}: {
  keys: { id: string; name: string; prefix: string; lastUsed: string | null; created: string }[];
  onCreate: (name: string) => Promise<{ key: string; prefix: string }>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
      {keys.length === 0 && <span style={{ color: "var(--color-neutral-700)" }}>No keys yet.</span>}
      {keys.map((k) => (
        <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "baseline", paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-300)" }}>
          <b style={{ flex: 1 }}>{k.name}</b>
          <code style={{ fontSize: 11.5 }}>{k.prefix}…</code>
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)", width: 150 }}>{k.lastUsed ? `used ${k.lastUsed}` : `made ${k.created}`}</span>
          <button
            type="button"
            className="hov-invert"
            disabled={pending}
            onClick={() => run(() => onRevoke(k.id))}
            style={{ fontSize: 10.5, border: "1px solid var(--color-neutral-400)", padding: "3px 7px" }}
          >
            Revoke
          </button>
        </div>
      ))}

      {fresh ? (
        <div style={{ border: "2px solid var(--color-accent)", padding: "10px 12px", background: "var(--color-surface)" }}>
          <b>Copy this key now — it won&rsquo;t be shown again.</b>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <code style={{ flex: 1, wordBreak: "break-all", fontSize: 12 }}>{fresh}</code>
            <button
              type="button"
              className="hov-accent"
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                setCopied(true);
              }}
              style={{ fontSize: 11, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "5px 10px" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button type="button" onClick={() => setFresh(null)} style={{ marginTop: 8, fontSize: 11, color: "var(--color-neutral-700)" }}>
            Done
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What it's for, e.g. Website"
            aria-label="Key name"
            style={{ flex: 1, border: "1px solid var(--color-neutral-400)", padding: "7px 9px", fontSize: 12, fontFamily: "inherit", background: "var(--color-bg)", color: "var(--color-text)" }}
          />
          <button
            type="button"
            className="hov-accent"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await onCreate(name || "Website");
                setFresh(r.key);
                setCopied(false);
                setName("");
              })
            }
            style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px" }}
          >
            {pending ? "Making…" : "Make a key"}
          </button>
        </div>
      )}
      {error && <span style={{ fontSize: 11, color: "var(--color-accent-700)" }}>{error}</span>}
    </div>
  );
}
