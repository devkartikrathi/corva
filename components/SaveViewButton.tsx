"use client";

import { useState, useTransition } from "react";
import type { Params } from "@/lib/params";

/**
 * Name the current filter set.
 *
 * Only offered when there is actually a filter to save — naming "everything"
 * produces a tab that duplicates the one beside it.
 */
export function SaveViewButton({
  surface,
  query,
  onSave,
}: {
  surface: string;
  query: Params;
  onSave: (surface: string, name: string, query: Record<string, string>) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const { page: _page, ...filters } = query;
  const count = Object.keys(filters).length;
  if (count === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="hov-ink"
        onClick={() => setOpen(true)}
        style={{ padding: "9px 12px", fontSize: 12.5, fontWeight: 700, color: "var(--color-accent-700)" }}
      >
        + Save this view
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px" }}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && name.trim()) {
            setError(null);
            start(async () => {
              try {
                await onSave(surface, name, filters);
                setOpen(false);
                setName("");
              } catch (err) {
                setError(err instanceof Error ? err.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }
        }}
        placeholder={`Name these ${count} filter${count === 1 ? "" : "s"}`}
        aria-label="View name"
        style={{
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "4px 8px",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--color-text)",
          borderRadius: 0,
          width: 190,
        }}
      />
      <button
        type="button"
        className="hov-accent"
        disabled={pending || !name.trim()}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              await onSave(surface, name, filters);
              setOpen(false);
              setName("");
            } catch (err) {
              setError(err instanceof Error ? err.message.replace(/^Error:\s*/, "") : "Failed.");
            }
          });
        }}
        style={{
          fontSize: 11,
          fontWeight: 700,
          background: name.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
          color: "var(--color-bg)",
          padding: "4px 9px",
        }}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className="hov-ink"
        onClick={() => setOpen(false)}
        style={{ fontSize: 11, color: "var(--color-neutral-700)" }}
      >
        Cancel
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
