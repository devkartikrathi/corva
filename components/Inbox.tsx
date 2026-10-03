"use client";

import { useState, useTransition } from "react";

const small = { fontSize: 11, fontWeight: 700, border: "1px solid var(--color-neutral-400)", padding: "5px 9px", cursor: "pointer", background: "var(--color-bg)" } as const;

/** The business's Corva address, with a copy button. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <code style={{ fontSize: 13, fontWeight: 700, padding: "5px 8px", border: "2px solid var(--color-text)", background: "var(--color-surface)", wordBreak: "break-all" }}>{address}</code>
      <button
        type="button"
        style={small}
        onClick={() => {
          void navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/**
 * Answer a customer's email from Corva. It goes out in the business's name,
 * says which message it answers, and the customer's reply comes back here.
 */
export function EmailReply({ conversationId, to, onReply }: { conversationId: string; to: string; onReply: (conversationId: string, body: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent) return <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>Reply sent to {to}.</span>;
  if (!open)
    return (
      <button type="button" style={small} onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        autoFocus
        placeholder={`Your reply to ${to}`}
        aria-label="Reply"
        style={{ border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={pending || !body.trim()}
          className="hov-accent"
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px", cursor: "pointer" }}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                await onReply(conversationId, body);
                setSent(true);
              } catch (e) {
                setError(e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "It could not be sent.");
              }
            })
          }
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
        <button type="button" style={small} onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
