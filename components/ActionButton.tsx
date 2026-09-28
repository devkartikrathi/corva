"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

/**
 * A button that runs a server action.
 *
 * Three things it does that a bare `<button onClick>` does not: it disables
 * itself while the action is in flight, it shows what the server actually
 * said when the action is refused, and it never optimistically claims success.
 * Authorization failures are the expected case here, not an edge case — a
 * Manager pressing "approve" above their ceiling should see why.
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "primary",
  confirm,
  style,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "outline" | "hairline" | "dark-primary" | "dark-outline";
  /** Ask before running. Use for anything a person would want to undo. */
  confirm?: string;
  style?: CSSProperties;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        // A redirect is the action succeeding, not failing — let the router have it.
        unstable_rethrow(e);
        // Production builds replace whatever the action threw with React's
        // minified #441, so the reason only survives in development. Say what
        // we know rather than print a link to the React docs.
        const message = e instanceof Error ? e.message : "Something went wrong.";
        setError(
          message.startsWith("Minified React error")
            ? "The server refused that. Refresh to see where things stand."
            : message.replace(/^Error:\s*/, ""),
        );
      }
    });
  };

  const base: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    padding: "9px 14px",
    cursor: pending ? "progress" : "pointer",
    opacity: pending ? 0.6 : 1,
    transition: "opacity 120ms ease",
  };

  const variants: Record<string, { className: string; style: CSSProperties }> = {
    primary: {
      className: "hov-accent",
      style: { background: "var(--color-accent)", color: "var(--color-bg)", fontWeight: 700, padding: "10px 14px" },
    },
    outline: {
      className: "hov-invert",
      style: { border: "2px solid var(--color-text)", padding: "8px 14px" },
    },
    hairline: {
      className: "hov-border",
      style: { border: "1px solid var(--color-neutral-400)", padding: "5px 10px" },
    },
    "dark-primary": {
      className: "hov-accent-dark",
      style: { background: "var(--color-accent)", color: "var(--color-bg)", fontWeight: 700, padding: "10px 14px" },
    },
    "dark-outline": {
      className: "hov-invert-dark",
      style: { border: "2px solid var(--color-bg)", padding: "8px 14px" },
    },
  };

  const v = variants[variant];

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button
        type="button"
        className={v.className}
        onClick={run}
        disabled={pending}
        aria-busy={pending}
        style={{ ...base, ...v.style, ...style }}
      >
        {pending ? (pendingLabel ?? "Working…") : children}
      </button>
      {error && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--color-accent-700)",
            maxWidth: "34ch",
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * A switch that runs a server action. Reflects the server's state, not a local
 * guess, so a refused toggle snaps back rather than lying.
 */
export function ActionToggle({
  on,
  action,
  label,
  dark = false,
}: {
  on: boolean;
  action: (next: boolean) => Promise<unknown>;
  label: string;
  dark?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await action(!on);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            }
          });
        }}
        style={{
          width: 34,
          height: 18,
          background: on
            ? "var(--color-accent)"
            : dark
              ? "var(--color-neutral-700)"
              : "var(--color-neutral-400)",
          display: "block",
          position: "relative",
          opacity: pending ? 0.6 : 1,
          cursor: pending ? "progress" : "pointer",
          transition: "background 120ms ease, opacity 120ms ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 18 : 2,
            width: 14,
            height: 14,
            background: "var(--color-bg)",
            display: "block",
            transition: "left 120ms ease",
          }}
        />
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
