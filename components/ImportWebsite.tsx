"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * "Read my website" — the fastest way to teach the AI something.
 *
 * Takes a while (it fetches several pages and rewrites them), so the button
 * says what it is doing, and the result says how many pages it read.
 */
export function ImportWebsite({
  onImport,
}: {
  onImport: (url: string) => Promise<{ id: string; pages: number; rewritten: boolean }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        className="hov-invert"
        onClick={() => setOpen(true)}
        style={{ fontSize: 12, fontWeight: 600, border: "2px solid var(--color-text)", padding: "8px 13px" }}
      >
        {note ?? "Import a website"}
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", gap: 6 }}>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourbusiness.in"
          aria-label="Website"
          style={{
            border: "1px solid var(--color-neutral-400)",
            padding: "7px 9px",
            fontSize: 12,
            fontFamily: "inherit",
            width: 190,
            background: "var(--color-bg)",
            color: "var(--color-text)",
          }}
        />
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !url.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                const r = await onImport(url);
                setNote(`Read ${r.pages} page${r.pages === 1 ? "" : "s"} ✓`);
                setOpen(false);
                setUrl("");
                router.push(`/app/knowledge/${r.id}`);
              } catch (e) {
                setError(
                  e instanceof Error && !e.message.startsWith("Minified React error")
                    ? e.message.replace(/^Error:\s*/, "")
                    : "Could not read that website.",
                );
              }
            });
          }}
          style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px" }}
        >
          {pending ? "Reading…" : "Read it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
          Cancel
        </button>
      </span>
      {error && <span style={{ fontSize: 11, color: "var(--color-accent-700)" }}>{error}</span>}
    </span>
  );
}
