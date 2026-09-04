"use client";

import { useState, useTransition } from "react";

/**
 * Who owns this account.
 *
 * A list of real colleagues plus "AI only" and "Unassigned", rather than a
 * text field: the owner name is matched against the team on other screens, and
 * three spellings of the same person quietly break every one of them.
 */
export function OwnerPicker({
  customerId,
  current,
  options,
  onAssign,
}: {
  customerId: string;
  current: string | null;
  options: string[];
  onAssign: (customerId: string, owner: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (value: string | null) => {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      try {
        await onAssign(customerId, value);
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
        {pending ? "Saving…" : current ? `Owner · ${current}` : "Assign owner"}
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
            minWidth: 190,
            padding: 0,
            listStyle: "none",
            background: "var(--color-bg)",
            border: "2px solid var(--color-text)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {["AI only", ...options].map((name) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={current === name}
                className="hov-raise"
                onClick={() => choose(name)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: 12.5,
                  fontWeight: current === name ? 700 : 400,
                }}
              >
                {name}
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
              Unassign
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
