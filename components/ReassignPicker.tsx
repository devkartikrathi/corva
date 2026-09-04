"use client";

import { useState, useTransition } from "react";

/**
 * Hand a brief to a colleague.
 *
 * Separate from "accept", because triaging a queue and working it are
 * different jobs done by different people. Returning it to the queue is in the
 * same menu, since the commonest correction to a misassignment is to undo it.
 */
export function ReassignPicker({
  handoffId,
  current,
  options,
  onReassign,
}: {
  handoffId: string;
  current: string | null;
  options: { id: string; name: string; role: string }[];
  onReassign: (handoffId: string, membershipId: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (membershipId: string | null) => {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        await onReassign(handoffId, membershipId);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
      }
    });
  };

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="hov-invert"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          fontSize: 12,
          fontWeight: 600,
          border: "2px solid var(--color-text)",
          padding: "8px 14px",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Moving…" : current ? `With ${current}` : "Assign to…"}
      </button>
      {open && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 30,
            minWidth: 210,
            maxHeight: 280,
            overflowY: "auto",
            padding: 0,
            listStyle: "none",
            background: "var(--color-bg)",
            border: "2px solid var(--color-text)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={current === o.name}
                className="hov-raise"
                onClick={() => choose(o.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: 12.5,
                  display: "flex",
                  gap: 8,
                  fontWeight: current === o.name ? 700 : 400,
                }}
              >
                <span style={{ flex: 1 }}>{o.name}</span>
                <span style={{ color: "var(--color-neutral-700)", fontSize: 11 }}>{o.role}</span>
              </button>
            </li>
          ))}
          <li style={{ borderTop: "1px solid var(--color-neutral-300)" }}>
            <button
              type="button"
              className="hov-raise"
              onClick={() => choose(null)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 12.5,
                color: "var(--color-neutral-700)",
              }}
            >
              Put back on the queue
            </button>
          </li>
        </ul>
      )}
      {error && (
        <span
          role="alert"
          style={{ position: "absolute", top: "100%", left: 0, fontSize: 10.5, color: "var(--color-accent-700)" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
