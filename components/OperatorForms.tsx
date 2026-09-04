"use client";

import { useState, useTransition } from "react";

/**
 * Operator-side forms on the dark ground.
 *
 * The support-access request is the one that matters: it is the only path from
 * this console to a tenant's actual content, and it asks for a reason before
 * it will do anything — the reason is written into the tenant's own audit log,
 * where they read it.
 */

const field: React.CSSProperties = {
  border: "1px solid var(--color-neutral-600)",
  background: "transparent",
  color: "var(--color-bg)",
  padding: "7px 9px",
  fontSize: 12,
  fontFamily: "inherit",
  borderRadius: 0,
  width: "100%",
};

export function SupportAccessRequest({
  orgSlug,
  onRequest,
}: {
  orgSlug: string;
  onRequest: (orgSlug: string, reason: string, minutes?: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        className="hov-invert-dark"
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          fontSize: 11.5,
          fontWeight: 700,
          border: "2px solid var(--color-bg)",
          padding: "9px 12px",
        }}
      >
        Request time-boxed access
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Why you need it — the tenant reads this in their audit log"
        aria-label="Reason"
        style={{ ...field, resize: "vertical", lineHeight: 1.45 }}
      />
      <select
        value={String(minutes)}
        onChange={(e) => setMinutes(Number(e.target.value))}
        aria-label="Duration"
        style={field}
      >
        {[30, 60, 120, 240].map((m) => (
          <option key={m} value={m} style={{ color: "var(--color-text)" }}>
            {m} minutes
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 7 }}>
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || reason.trim().length < 8}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onRequest(orgSlug, reason, minutes);
                setOpen(false);
                setReason("");
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: reason.trim().length >= 8 ? "var(--color-accent)" : "var(--color-neutral-700)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Requesting…" : "Request"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ fontSize: 11.5, color: "var(--color-neutral-400)" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-400)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const NOTE_KINDS = [
  { value: "note", label: "Note" },
  { value: "risk", label: "Risk" },
  { value: "expansion", label: "Expansion" },
  { value: "incident", label: "Incident" },
];

export function AccountNoteForm({
  orgSlug,
  onAdd,
}: {
  orgSlug: string;
  onAdd: (orgSlug: string, kind: string, body: string) => Promise<unknown>;
}) {
  const [kind, setKind] = useState("note");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="What should the next person to open this account know?"
        aria-label="Account note"
        style={{ ...field, resize: "vertical", lineHeight: 1.45 }}
      />
      <div style={{ display: "flex", gap: 7 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ ...field, width: 130 }}>
          {NOTE_KINDS.map((k) => (
            <option key={k.value} value={k.value} style={{ color: "var(--color-text)" }}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || !body.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onAdd(orgSlug, kind, body);
                setBody("");
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: body.trim() ? "var(--color-accent)" : "var(--color-neutral-700)",
            color: "var(--color-bg)",
            padding: "7px 13px",
          }}
        >
          {pending ? "Saving…" : "Add"}
        </button>
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-400)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
