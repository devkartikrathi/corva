"use client";
import { formatRupees } from "@/lib/money";

import { useState, useTransition } from "react";

/**
 * The controls on the AI tuning screen.
 *
 * All of them write to a *draft* version — the server forks one from live on
 * the first edit — so nothing here can change what a call in progress is
 * allowed to do. That is the reason these are separate from the publish
 * button rather than saving straight through.
 */

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    start(async () => {
      try {
        await fn();
        after?.();
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
      }
    });
  };
  return { pending, error, run };
}

const Err = ({ children }: { children: string | null }) =>
  children ? (
    <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-700)" }}>
      {children}
    </span>
  ) : null;

/* ─── Persona ──────────────────────────────────────────────────────────── */

export function PersonaEditor({
  persona,
  onSave,
}: {
  persona: string;
  onSave: (persona: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(persona);
  const [editing, setEditing] = useState(false);
  const { pending, error, run } = useAction();

  if (!editing) {
    return (
      <div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{persona}</div>
        <button
          type="button"
          className="hov-ink"
          onClick={() => {
            setValue(persona);
            setEditing(true);
          }}
          style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-700)" }}
        >
          Edit the persona →
        </button>
      </div>
    );
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={7}
        aria-label="Persona"
        style={{
          width: "100%",
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "10px 12px",
          fontSize: 13,
          fontFamily: "inherit",
          lineHeight: 1.6,
          color: "var(--color-text)",
          borderRadius: 0,
          resize: "vertical",
        }}
      />
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || value.trim() === persona.trim()}
          onClick={() => run(() => onSave(value), () => setEditing(false))}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background:
              pending || value.trim() === persona.trim() ? "var(--color-neutral-400)" : "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Saving…" : "Save to the draft"}
        </button>
        <button
          type="button"
          className="hov-ink"
          onClick={() => setEditing(false)}
          style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}
        >
          Cancel
        </button>
        <Err>{error}</Err>
      </div>
    </div>
  );
}

/* ─── Tone ─────────────────────────────────────────────────────────────── */

export function ToneDial({
  label,
  value,
  low,
  high,
  onChange,
}: {
  label: string;
  value: number;
  low: string;
  high: string;
  onChange: (value: number) => Promise<unknown>;
}) {
  const { pending, error, run } = useAction();
  const [optimistic, setOptimistic] = useState(value);

  return (
    <div style={{ opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: "var(--color-neutral-800)" }}>{label}</span>
        <b>{optimistic} / 10</b>
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${label} ${i}`}
            aria-pressed={optimistic === i}
            disabled={pending}
            onClick={() => {
              setOptimistic(i);
              run(() => onChange(i), undefined);
            }}
            style={{
              flex: 1,
              height: 14,
              background:
                i <= optimistic
                  ? optimistic === i
                    ? "var(--color-accent)"
                    : "var(--color-text)"
                  : "var(--color-neutral-300)",
              cursor: pending ? "progress" : "pointer",
            }}
          />
        ))}
      </div>
      <div
        style={{
          marginTop: 4,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "var(--color-neutral-700)",
        }}
      >
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <Err>{error}</Err>
    </div>
  );
}

/* ─── Authority ────────────────────────────────────────────────────────── */

export type AuthorityRow = {
  id: string;
  action: string;
  blocked: boolean;
  ceilingPaise: number | null;
  escalateTo: string | null;
};

export function AuthorityCell({
  row,
  onSave,
}: {
  row: AuthorityRow;
  onSave: (
    limitId: string,
    input: { blocked: boolean; ceilingPaise: number | null; escalateTo: string | null },
  ) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"blocked" | "unlimited" | "capped">(
    row.blocked ? "blocked" : row.ceilingPaise === null ? "unlimited" : "capped",
  );
  const [amount, setAmount] = useState(row.ceilingPaise === null ? "" : String(row.ceilingPaise / 100));
  const [escalate, setEscalate] = useState(row.escalateTo ?? "");
  const { pending, error, run } = useAction();

  const label = row.blocked
    ? "blocked"
    : row.ceilingPaise === null
      ? "unlimited"
      : formatRupees(row.ceilingPaise);

  if (!editing) {
    return (
      <button
        type="button"
        className="hov-ink"
        onClick={() => setEditing(true)}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: row.blocked ? "var(--color-accent-700)" : "var(--color-text)",
          borderBottom: "1px dashed var(--color-neutral-400)",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <span style={{ display: "flex", gap: 3 }}>
        {(["blocked", "unlimited", "capped"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 6px",
              border: `1px solid ${mode === m ? "var(--color-text)" : "var(--color-neutral-400)"}`,
              background: mode === m ? "var(--color-text)" : "transparent",
              color: mode === m ? "var(--color-bg)" : "var(--color-neutral-700)",
            }}
          >
            {m}
          </button>
        ))}
      </span>
      {mode === "capped" && (
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="5000"
          aria-label="Ceiling in rupees"
          style={{
            width: 78,
            border: "1px solid var(--color-neutral-400)",
            background: "var(--color-surface)",
            padding: "4px 6px",
            fontSize: 12,
            fontFamily: "inherit",
            color: "var(--color-text)",
            borderRadius: 0,
          }}
        />
      )}
      <select
        value={escalate}
        onChange={(e) => setEscalate(e.target.value)}
        aria-label="Who approves above this"
        style={{
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "4px 6px",
          fontSize: 11.5,
          fontFamily: "inherit",
          color: "var(--color-text)",
          borderRadius: 0,
        }}
      >
        <option value="">no escalation path</option>
        <option value="human">any human</option>
        <option value="manager">a manager</option>
        <option value="owner">the owner</option>
      </select>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                onSave(row.id, {
                  blocked: mode === "blocked",
                  ceilingPaise: mode === "capped" ? Math.round(Number(amount || 0) * 100) : null,
                  escalateTo: escalate || null,
                }),
              () => setEditing(false),
            )
          }
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
          className="hov-ink"
          onClick={() => setEditing(false)}
          style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}
        >
          Cancel
        </button>
      </span>
      <Err>{error}</Err>
    </span>
  );
}

/* ─── Never-do list ────────────────────────────────────────────────────── */

export function NeverRules({
  rules,
  onAdd,
  onRemove,
}: {
  rules: { id: string; text: string }[];
  onAdd: (description: string) => Promise<unknown>;
  onRemove: (ruleId: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const { pending, error, run } = useAction();

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
        {rules.map((n) => (
          <div key={n.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>✗</span>
            <span style={{ flex: 1 }}>{n.text}</span>
            <button
              type="button"
              className="hov-ink"
              disabled={pending}
              onClick={() => run(() => onRemove(n.id))}
              aria-label={`Remove: ${n.text}`}
              style={{ fontSize: 13, color: "var(--color-neutral-500)", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) run(() => onAdd(value), () => setValue(""));
          }}
          placeholder="Never quote a lead time from memory"
          aria-label="Add a never-do rule"
          style={{
            flex: 1,
            border: "1px solid var(--color-neutral-400)",
            background: "var(--color-surface)",
            padding: "6px 9px",
            fontSize: 12,
            fontFamily: "inherit",
            color: "var(--color-text)",
            borderRadius: 0,
          }}
        />
        <button
          type="button"
          className="hov-invert"
          disabled={pending || !value.trim()}
          onClick={() => run(() => onAdd(value), () => setValue(""))}
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            border: "1px solid var(--color-text)",
            padding: "5px 11px",
          }}
        >
          Add
        </button>
      </div>
      <Err>{error}</Err>
    </div>
  );
}

/* ─── Test console ─────────────────────────────────────────────────────── */

export function TestConsole({
  version,
  onAsk,
}: {
  version: number;
  onAsk: (message: string) => Promise<{
    version: number;
    escalated: boolean;
    reason: string | null;
    text: string;
    citations: { title: string; anchor: string | null; confidence: number }[];
    modelId: string;
    modelLabel: string;
  }>;
}) {
  const [value, setValue] = useState("");
  const [reply, setReply] = useState<Awaited<ReturnType<typeof onAsk>> | null>(null);
  const { pending, error, run } = useAction();

  const ask = () => {
    const message = value.trim();
    if (!message) return;
    run(async () => {
      const result = await onAsk(message);
      setReply(result);
    });
  };

  return (
    <div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ask();
        }}
        aria-label="Test the agent"
        placeholder="Type what a customer might say…"
        style={{
          marginTop: 12,
          width: "100%",
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "11px 12px",
          fontSize: 12.5,
          fontFamily: "inherit",
          color: "var(--color-text)",
          borderRadius: 0,
        }}
      />
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !value.trim()}
          onClick={ask}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: value.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Thinking…" : `Ask v${version}`}
        </button>
        <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>
          Nothing is recorded{reply ? ` · answered by ${reply.modelLabel}` : ""}
        </span>
      </div>
      <Err>{error}</Err>

      {reply && (
        <div
          style={{
            marginTop: 14,
            borderLeft: `3px solid ${reply.escalated ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
            paddingLeft: 11,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: reply.escalated ? "var(--color-accent-700)" : "var(--color-neutral-700)",
            }}
          >
            {reply.escalated ? "It would stop and escalate" : `v${reply.version} would say`}
          </div>
          <p style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>{reply.text}</p>
          {reply.reason && (
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-accent-800)" }}>
              Trigger: {reply.reason}
            </p>
          )}
          {reply.citations.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {reply.citations.map((c, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    background: "var(--color-accent-200)",
                    color: "var(--color-accent-800)",
                    padding: "3px 7px",
                  }}
                >
                  {c.title}
                  {c.anchor ? ` · ${c.anchor}` : ""} · {Math.round(c.confidence * 100)}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
