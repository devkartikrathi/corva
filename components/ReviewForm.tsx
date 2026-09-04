"use client";

import { useState, useTransition } from "react";

/**
 * Scoring a finished conversation.
 *
 * A 1–5 score plus a note, because the number alone tells the next reviewer
 * nothing about why. Shows the existing review rather than an empty form when
 * one exists — re-scoring is deliberate, not something you do by not noticing
 * a score was already there.
 */
export function ReviewForm({
  conversationId,
  current,
  reviewer,
  note,
  onReview,
}: {
  conversationId: string;
  current: number | null;
  reviewer: string | null;
  note: string | null;
  onReview: (conversationId: string, score: number, note: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(current === null);
  const [score, setScore] = useState(current ?? 0);
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <b>{current} / 5</b>
        {reviewer && <span style={{ color: "var(--color-neutral-700)" }}>{reviewer}</span>}
        <button
          type="button"
          className="hov-ink"
          onClick={() => setOpen(true)}
          style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-700)" }}
        >
          Re-score
        </button>
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={score === n}
            onClick={() => setScore(n)}
            style={{
              width: 26,
              height: 26,
              fontSize: 12,
              fontWeight: 700,
              border: `1px solid ${score === n ? "var(--color-text)" : "var(--color-neutral-400)"}`,
              background: score === n ? "var(--color-text)" : "transparent",
              color: score === n ? "var(--color-bg)" : "inherit",
            }}
          >
            {n}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "var(--color-neutral-700)", marginLeft: 4 }}>
          1 wrong · 5 exactly right
        </span>
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What was right or wrong about it?"
        aria-label="Review note"
        style={{
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "7px 9px",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--color-text)",
          borderRadius: 0,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || score === 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await onReview(conversationId, score, text);
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: score === 0 ? "var(--color-neutral-400)" : "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "7px 12px",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "Save review"}
        </button>
        {current !== null && (
          <button
            type="button"
            className="hov-ink"
            onClick={() => setOpen(false)}
            style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}
          >
            Cancel
          </button>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-700)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
