"use client";

import { useState, useTransition } from "react";

/**
 * Where this business makes payment links — an endpoint in its own system
 * that Corva calls, signed, when the team or the assistant asks a customer to
 * pay. The signing secret is shown once, when the endpoint is set.
 */
export function PaymentEndpoint({
  current,
  onConnect,
  onDisconnect,
}: {
  current: { url: string; last: string | null; lastStatus: number | null; lastError: string | null } | null;
  onConnect: (url: string) => Promise<{ url: string; secret: string }>;
  onDisconnect: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
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
  const small = { fontSize: 10.5, border: "1px solid var(--color-neutral-400)", padding: "3px 7px" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
      {current ? (
        <div style={{ paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-300)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <code style={{ flex: 1, fontSize: 11.5, wordBreak: "break-all" }}>{current.url}</code>
            <button type="button" className="hov-invert" disabled={pending} style={small} onClick={() => run(onDisconnect)}>
              Remove
            </button>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--color-neutral-700)" }}>
            {current.last === null ? (
              "No payment asked for yet"
            ) : current.lastError ? (
              <b style={{ color: "var(--color-accent-700)" }}>
                last request failed ({current.lastError}) · {current.last}
              </b>
            ) : (
              `last link made ${current.last} (${current.lastStatus})`
            )}
          </div>
        </div>
      ) : (
        <span style={{ color: "var(--color-neutral-700)" }}>Not set up: neither the team nor the AI can ask a customer to pay yet.</span>
      )}

      {secret && (
        <div style={{ border: "2px solid var(--color-accent)", padding: "10px 12px", background: "var(--color-surface)" }}>
          <b>Copy this signing secret now — it won&rsquo;t be shown again.</b> Your system checks every request with it.
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <code style={{ flex: 1, fontSize: 11.5, wordBreak: "break-all" }}>{secret}</code>
            <button
              type="button"
              style={small}
              onClick={() => {
                void navigator.clipboard.writeText(secret);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" style={small} onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-site.com/api/corva/payments"
          aria-label="Payment endpoint URL"
          style={{ flex: 1, border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0 }}
        />
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !url.trim()}
          onClick={() =>
            run(async () => {
              const made = await onConnect(url.trim());
              setSecret(made.secret);
              setCopied(false);
              setUrl("");
            })
          }
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "8px 13px", opacity: pending ? 0.6 : 1 }}
        >
          {current ? "Replace" : "Connect"}
        </button>
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
