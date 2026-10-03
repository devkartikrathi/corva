"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

const small = { fontSize: 11, fontWeight: 700, border: "1px solid var(--color-neutral-400)", padding: "4px 8px", cursor: "pointer", background: "var(--color-bg)" } as const;
const primary = { fontSize: 11, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "5px 9px", cursor: "pointer" } as const;
const errorText = (e: unknown) => (e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");

/**
 * "Possibly the same person": another record a conversation connected to this
 * one, with why. Merging folds the other record into this one.
 */
export function MatchCard({
  customerId,
  matchId,
  other,
  reasons,
  canMerge,
  onMerge,
  onDismiss,
}: {
  customerId: string;
  matchId: string;
  other: { id: string; name: string; phone: string | null; email: string | null; segment: string | null };
  reasons: string[];
  canMerge: boolean;
  onMerge: (intoId: string, fromId: string) => Promise<void>;
  onDismiss: (matchId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>, note: string) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        setDone(note);
      } catch (e) {
        setError(errorText(e));
      }
    });
  if (done) return <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>{done}</div>;
  return (
    <div style={{ border: "1px solid var(--color-neutral-300)", padding: "9px 10px", background: "var(--color-bg)", fontSize: 12 }}>
      <Link href={`/app/customers/${other.id}`} style={{ fontWeight: 700, color: "var(--color-text)" }}>
        {other.name}
      </Link>
      <div style={{ fontSize: 11.5, color: "var(--color-neutral-700)", marginTop: 2 }}>
        {[other.phone, other.email, other.segment].filter(Boolean).join(" · ") || "No number or email"}
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--color-neutral-800)", fontSize: 11.5, lineHeight: 1.45 }}>
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {canMerge && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 11.5 }}>Move everything of {other.name}&rsquo;s here and remove that record?</span>
              <button type="button" disabled={pending} style={primary} onClick={() => run(() => onMerge(customerId, other.id), `Merged ${other.name} into this customer.`)}>
                {pending ? "Merging…" : "Yes, merge"}
              </button>
              <button type="button" style={small} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" style={primary} onClick={() => setConfirming(true)}>
                Same person — merge
              </button>
              <button type="button" disabled={pending} style={small} onClick={() => run(() => onDismiss(matchId), "Marked as a different person.")}>
                Not the same
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 6, fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Merge in another record by the number or email on it. */
export function MergeIn({ customerId, onMerge }: { customerId: string; onMerge: (intoId: string, handle: string) => Promise<{ merged: string }> }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Their other number or email"
          aria-label="The other record's number or email"
          style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", borderRadius: 0 }}
        />
        <button
          type="button"
          disabled={pending || !value.trim()}
          style={small}
          onClick={() =>
            start(async () => {
              setError(null);
              setNote(null);
              try {
                const r = await onMerge(customerId, value);
                setNote(`Merged ${r.merged} into this customer.`);
                setValue("");
              } catch (e) {
                setError(errorText(e));
              }
            })
          }
        >
          {pending ? "Merging…" : "Merge in"}
        </button>
      </div>
      {note && <span style={{ fontSize: 11.5 }}>{note}</span>}
      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Confirm a number or email someone only said is theirs. */
export function ConfirmHandle({ identityId, onConfirm }: { identityId: string; onConfirm: (identityId: string) => Promise<void> }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [pending, start] = useTransition();
  if (state === "done") return <span style={{ fontSize: 10.5, fontWeight: 700 }}>Confirmed</span>;
  return (
    <button
      type="button"
      disabled={pending}
      title="You know this is theirs: it becomes verified, and their address on file if they have none"
      style={{ ...small, padding: "1px 6px", fontSize: 10.5 }}
      onClick={() =>
        start(async () => {
          try {
            await onConfirm(identityId);
            setState("done");
          } catch {
            setState("error");
          }
        })
      }
    >
      {state === "error" ? "Try again" : pending ? "…" : "Confirm"}
    </button>
  );
}
