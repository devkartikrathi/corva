"use client";

import { useState, useTransition } from "react";

/**
 * Triaging one flagged answer.
 *
 * The two fields that matter are status and owner, and they are shown together
 * because deciding "is this ours or theirs" *is* the triage — a status without
 * an owner sends the flag nowhere.
 */
const STATUSES = [
  { value: "open", label: "Open" },
  { value: "triaged", label: "Triaged" },
  { value: "fixed", label: "Fixed" },
  { value: "wont_fix", label: "Won't fix" },
];

export function TriageControl({
  flagId,
  status,
  owner,
  rootCause,
  onTriage,
}: {
  flagId: string;
  status: string;
  owner: string;
  rootCause: string;
  onTriage: (
    flagId: string,
    input: { status: string; owner: string; rootCause: string },
  ) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(status);
  const [who, setWho] = useState(owner);
  const [cause, setCause] = useState(rootCause);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field: React.CSSProperties = {
    border: "1px solid var(--color-neutral-600)",
    background: "transparent",
    color: "var(--color-bg)",
    padding: "3px 6px",
    fontSize: 11.5,
    fontFamily: "inherit",
    borderRadius: 0,
    width: "100%",
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11,
          fontWeight: 600,
          border: "1px solid var(--color-neutral-600)",
          padding: "3px 8px",
          color: status === "open" ? "var(--color-accent-400)" : "var(--color-neutral-300)",
        }}
      >
        {STATUSES.find((s) => s.value === status)?.label ?? status} ·{" "}
        {owner === "corva" ? "ours" : "theirs"}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 5, width: 180 }}>
      <select value={next} onChange={(e) => setNext(e.target.value)} aria-label="Status" style={field}>
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value} style={{ color: "var(--color-text)" }}>
            {s.label}
          </option>
        ))}
      </select>
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Owner" style={field}>
        <option value="corva" style={{ color: "var(--color-text)" }}>
          Corva fixes it
        </option>
        <option value="tenant" style={{ color: "var(--color-text)" }}>
          The tenant fixes it
        </option>
      </select>
      <input
        value={cause}
        onChange={(e) => setCause(e.target.value)}
        placeholder="Root cause"
        aria-label="Root cause"
        style={field}
      />
      <span style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onTriage(flagId, { status: next, owner: who, rootCause: cause });
                setOpen(false);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            background: "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "4px 9px",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ fontSize: 10.5, color: "var(--color-neutral-400)" }}
        >
          Cancel
        </button>
      </span>
      {error && (
        <span role="alert" style={{ fontSize: 10, color: "var(--color-accent-400)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
