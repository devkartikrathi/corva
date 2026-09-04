"use client";

import { useState, useTransition } from "react";

/**
 * What this customer has agreed to.
 *
 * Every row is togglable, and an unrecorded consent shows as "never asked"
 * rather than as a "no" — the difference matters legally and is exactly the
 * kind of thing a screen quietly flattens if you let it.
 */
export type ConsentRow = {
  kind: string;
  label: string;
  granted: boolean;
  detail: string | null;
  recorded: boolean;
};

export function ConsentPanel({
  customerId,
  rows,
  onSet,
}: {
  customerId: string;
  rows: ConsentRow[];
  onSet: (customerId: string, kind: string, granted: boolean, detail: string) => Promise<unknown>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
      {rows.map((r) => (
        <div key={r.kind} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
            {r.label}
            {r.detail && (
              <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)", marginTop: 2 }}>
                {r.detail}
              </span>
            )}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={r.granted}
            aria-label={`${r.label}: ${r.granted ? "granted" : "not granted"}`}
            disabled={pending}
            onClick={() => {
              setError(null);
              setBusy(r.kind);
              startTransition(async () => {
                try {
                  await onSet(customerId, r.kind, !r.granted, "");
                } catch (e) {
                  setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
                } finally {
                  setBusy(null);
                }
              });
            }}
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "3px 8px",
              minWidth: 76,
              textAlign: "center",
              border: `1px solid ${r.granted ? "var(--color-text)" : "var(--color-neutral-400)"}`,
              background: r.granted ? "var(--color-text)" : "transparent",
              color: r.granted ? "var(--color-bg)" : "var(--color-neutral-700)",
              opacity: busy === r.kind ? 0.5 : 1,
              cursor: pending ? "progress" : "pointer",
            }}
          >
            {r.granted ? "Granted" : r.recorded ? "Withdrawn" : "Never asked"}
          </button>
        </div>
      ))}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
