"use client";

import { useState, useTransition } from "react";

/**
 * Where Corva sends events for this business.
 *
 * The signing secret is shown once, when a webhook is made — it is what the
 * receiving server uses to check a delivery really came from Corva. The last
 * delivery's result sits beside each URL, so an endpoint that has stopped
 * answering is visible here.
 */
type Hook = { id: string; url: string; events: string[]; last: string | null; lastStatus: number | null; lastError: string | null };

export function Webhooks({
  hooks,
  events,
  onCreate,
  onDelete,
  onTest,
}: {
  hooks: Hook[];
  events: { type: string; description: string }[];
  onCreate: (url: string, events: string[]) => Promise<{ id: string; secret: string }>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<{ status: number; error: string | null }>;
}) {
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(events.map((e) => e.type));
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
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
      {hooks.length === 0 && <span style={{ color: "var(--color-neutral-700)" }}>No webhooks yet.</span>}
      {hooks.map((h) => (
        <div key={h.id} style={{ paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-300)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <code style={{ flex: 1, fontSize: 11.5, wordBreak: "break-all" }}>{h.url}</code>
            <button type="button" className="hov-invert" disabled={pending} style={small}
              onClick={() => run(async () => {
                const r = await onTest(h.id);
                setNote(r.error ? `Test to ${new URL(h.url).host} failed: ${r.error}` : `Test delivered — ${new URL(h.url).host} answered ${r.status}.`);
              })}
            >
              Send test
            </button>
            <button type="button" className="hov-invert" disabled={pending} style={small} onClick={() => run(() => onDelete(h.id))}>
              Remove
            </button>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--color-neutral-700)" }}>
            {h.events.length === 0 ? "All events" : h.events.join(", ")}
            {" · "}
            {h.last === null ? (
              "nothing sent yet"
            ) : h.lastError ? (
              <b style={{ color: "var(--color-accent-700)" }}>last delivery failed ({h.lastError}) · {h.last}</b>
            ) : (
              `last delivered ${h.last} (${h.lastStatus})`
            )}
          </div>
        </div>
      ))}

      {secret && (
        <div style={{ border: "2px solid var(--color-accent)", padding: "10px 12px", background: "var(--color-surface)" }}>
          <b>Copy this signing secret now — it won&rsquo;t be shown again.</b>
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
          placeholder="https://your-site.com/api/corva-webhook"
          aria-label="Webhook URL"
          style={{ flex: 1, border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0 }}
        />
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !url.trim() || chosen.length === 0}
          onClick={() =>
            run(async () => {
              const made = await onCreate(url.trim(), chosen);
              setSecret(made.secret);
              setCopied(false);
              setUrl("");
            })
          }
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "8px 13px", opacity: pending ? 0.6 : 1 }}
        >
          Add webhook
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11.5 }}>
        {events.map((e) => (
          <label key={e.type} title={e.description} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input
              type="checkbox"
              checked={chosen.includes(e.type)}
              onChange={(ev) => setChosen((c) => (ev.target.checked ? [...c, e.type] : c.filter((x) => x !== e.type)))}
            />
            <code style={{ fontSize: 11 }}>{e.type}</code>
          </label>
        ))}
      </div>
      {note && <span style={{ fontSize: 11.5 }}>{note}</span>}
      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
