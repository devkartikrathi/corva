"use client";

import { useState, useTransition } from "react";

/**
 * Posting an incident update.
 *
 * Choosing "resolved" closes the incident, rather than resolving being a
 * separate button someone forgets after writing "all clear" — the stage and
 * the state of the incident are the same fact, so they are one control.
 */
const STAGES = [
  { value: "investigating", label: "Investigating" },
  { value: "identified", label: "Identified" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved — closes it" },
] as const;

export function IncidentUpdateForm({
  incidentId,
  onPost,
}: {
  incidentId: string;
  onPost: (
    incidentId: string,
    stage: "investigating" | "identified" | "monitoring" | "resolved",
    body: string,
  ) => Promise<unknown>;
}) {
  const [stage, setStage] = useState<(typeof STAGES)[number]["value"]>("monitoring");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field: React.CSSProperties = {
    border: "1px solid var(--color-neutral-600)",
    background: "transparent",
    color: "var(--color-bg)",
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: "inherit",
    borderRadius: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 520 }}>
      <div style={{ display: "flex", gap: 7 }}>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as typeof stage)}
          aria-label="Stage"
          style={{ ...field, width: 190 }}
        >
          {STAGES.map((s) => (
            <option key={s.value} value={s.value} style={{ color: "var(--color-text)" }}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What changed?"
          aria-label="Update"
          style={{ ...field, flex: 1 }}
        />
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || !body.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onPost(incidentId, stage, body);
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
            padding: "6px 12px",
          }}
        >
          {pending ? "Posting…" : "Post"}
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
