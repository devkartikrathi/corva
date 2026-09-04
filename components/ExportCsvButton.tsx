"use client";

import { useState, useTransition } from "react";
import type { Params } from "@/lib/params";

/**
 * Export the current table as CSV.
 *
 * Passes the live query rather than a row list, so the file matches what the
 * filters select at the moment you press it — including rows on pages you have
 * not looked at. The server re-runs the same query the screen ran.
 */
export function ExportCsvButton({
  filename,
  query,
  onExport,
}: {
  filename: string;
  query: Params;
  onExport: (query: Params) => Promise<string>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="hov-invert"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const csv = await onExport(query);
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
            }
          });
        }}
        style={{
          fontSize: 12,
          fontWeight: 600,
          border: "2px solid var(--color-text)",
          padding: "8px 14px",
          opacity: pending ? 0.6 : 1,
          cursor: pending ? "progress" : "pointer",
        }}
      >
        {pending ? "Building…" : "Export CSV"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)", maxWidth: "24ch" }}>
          {error}
        </span>
      )}
    </span>
  );
}
