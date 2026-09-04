"use client";

import { useState, useTransition } from "react";

/**
 * What people have written about this customer.
 *
 * Pinned notes sort first and stay visible, because the reason to write one is
 * usually "do not let the next person repeat what just went wrong" — and that
 * only works if it is above the fold rather than at the bottom of a list.
 */
export type Note = {
  id: string;
  authorName: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  mine: boolean;
};

export function CustomerNotes({
  customerId,
  notes,
  onAdd,
  onDelete,
}: {
  customerId: string;
  notes: Note[];
  onAdd: (customerId: string, body: string, pinned: boolean) => Promise<unknown>;
  onDelete: (noteId: string) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const text = body.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await onAdd(customerId, text, pinned);
        setBody("");
        setPinned(false);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
      }
    });
  };

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {notes.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-neutral-700)" }}>
            Nothing written yet. A note here is read by whoever picks this customer up next,
            including from a handoff brief.
          </p>
        )}
        {notes.map((n) => (
          <div
            key={n.id}
            style={{
              borderLeft: `3px solid ${n.pinned ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
              paddingLeft: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
              <b>{n.authorName}</b>
              <span style={{ color: "var(--color-neutral-700)" }}>{n.createdAt}</span>
              {n.pinned && (
                <span style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>PINNED</span>
              )}
              {n.mine && (
                <button
                  type="button"
                  className="hov-ink"
                  onClick={() => startTransition(async () => void (await onDelete(n.id)))}
                  style={{
                    marginLeft: "auto",
                    fontSize: 10.5,
                    color: "var(--color-neutral-700)",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>{n.body}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note for whoever picks this up next…"
          aria-label="Add a note"
          style={{
            border: "1px solid var(--color-neutral-400)",
            background: "var(--color-surface)",
            padding: "8px 10px",
            fontSize: 12,
            fontFamily: "inherit",
            lineHeight: 1.45,
            color: "var(--color-text)",
            borderRadius: 0,
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              style={{ accentColor: "var(--color-accent)" }}
            />
            Pin to the top
          </label>
          <button
            type="button"
            className="hov-accent"
            disabled={pending || !body.trim()}
            onClick={submit}
            style={{
              marginLeft: "auto",
              fontSize: 11.5,
              fontWeight: 700,
              background: body.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
              color: "var(--color-bg)",
              padding: "7px 12px",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "Saving…" : "Add note"}
          </button>
        </div>
        {error && (
          <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-700)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
