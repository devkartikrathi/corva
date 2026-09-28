"use client";

import { useState, useTransition } from "react";

/**
 * Remove the saved view you are currently looking at.
 *
 * Offered on the open view rather than as a "×" on every tab, for the same
 * reason the strip highlights by query and not by id: the tab you are on is
 * the one you have an opinion about. A row of delete crosses turns a
 * navigation strip into a list of things to be careful around.
 *
 * The default view has no control at all — the server refuses to delete it,
 * and offering a button that always fails is worse than offering none.
 */
export function RemoveViewButton({
  view,
  onDelete,
}: {
  view: { id: string; name: string; isDefault: boolean };
  onDelete: (viewId: string) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (view.isDefault) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className="hov-ink"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Remove the saved view “${view.name}”? The filters stay in the URL.`)) {
            return;
          }
          setError(null);
          start(async () => {
            try {
              await onDelete(view.id);
            } catch (e) {
              setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
            }
          });
        }}
        style={{
          padding: "9px 12px",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--color-neutral-700)",
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Removing…" : "Remove this view"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
