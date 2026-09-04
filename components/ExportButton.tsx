"use client";

import { useState, useTransition } from "react";

/**
 * Export a transcript.
 *
 * The file is built on the server — that is where the capability check and the
 * audit row live — and handed back as text the browser saves. Doing it this
 * way rather than linking to a route means an export cannot happen without
 * passing the same `transcripts.export` check every other read passes.
 */
export function ExportButton({
  conversationId,
  filename,
  onExport,
  label = "Export transcript",
}: {
  conversationId: string;
  filename: string;
  onExport: (conversationId: string) => Promise<string>;
  label?: string;
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
              const text = await onExport(conversationId);
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
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
          fontSize: 11.5,
          fontWeight: 600,
          border: "1px solid var(--color-text)",
          padding: "8px 12px",
          opacity: pending ? 0.6 : 1,
          cursor: pending ? "progress" : "pointer",
        }}
      >
        {pending ? "Preparing…" : label}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)", maxWidth: "22ch" }}>
          {error}
        </span>
      )}
    </span>
  );
}
