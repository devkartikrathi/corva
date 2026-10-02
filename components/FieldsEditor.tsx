"use client";

import { useState, useTransition } from "react";
import type { FieldKind, IntakeField } from "@/lib/business/intake";

/**
 * The list of details the AI collects, edited in place.
 *
 * Nothing is saved until Save: reordering, adding and removing are cheap to
 * try, and the AI should not see a half-edited list mid-conversation.
 */

const KINDS: { value: FieldKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "choice", label: "One of a list" },
  { value: "address", label: "Address" },
  { value: "date", label: "Date / time" },
  { value: "number", label: "Number" },
  { value: "phone", label: "Phone number" },
  { value: "email", label: "Email" },
];

type Row = IntakeField & { id: string; optionsText: string };

const PERMANENT = new Set(["name", "phone"]);
let counter = 0;
const toRow = (f: IntakeField): Row => ({ ...f, id: `${f.key}-${counter++}`, optionsText: f.options.join(", ") });

const input = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
  width: "100%",
} as const;

const small = { fontSize: 11.5, fontWeight: 700, padding: "6px 10px", border: "1px solid var(--color-neutral-400)", cursor: "pointer" } as const;

export function FieldsEditor({
  initial,
  agentName,
  onSave,
  onReset,
}: {
  initial: IntakeField[];
  agentName: string;
  onSave: (fields: Omit<IntakeField, "builtIn">[]) => Promise<IntakeField[]>;
  onReset: () => Promise<IntakeField[]>;
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const change = (id: string, patch: Partial<Row>) => {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(false);
  };
  const move = (index: number, by: number) => {
    setRows((all) => {
      const next = [...all];
      const [row] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, row);
      return next;
    });
    setDirty(true);
    setSaved(false);
  };

  const save = () =>
    start(async () => {
      setError(null);
      try {
        const result = await onSave(
          rows.map((r) => ({
            // Kept when a field is renamed, so answers already collected still show.
            key: r.key,
            label: r.label,
            hint: r.hint,
            kind: r.kind,
            options: r.optionsText.split(",").map((o) => o.trim()).filter(Boolean),
            required: r.required,
          })),
        );
        setRows(result.map(toRow));
        setDirty(false);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Could not save.");
      }
    });

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r, i) => (
          <div
            key={r.id}
            style={{
              border: "1px solid var(--color-neutral-400)",
              background: "var(--color-bg)",
              padding: "12px 14px",
              display: "grid",
              gridTemplateColumns: "28px 1.2fr 1fr 1.6fr auto",
              gap: 10,
              alignItems: "start",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-neutral-500)", paddingTop: 8 }}>{i + 1}</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--color-neutral-700)" }}>
              Label
              <input
                value={r.label}
                maxLength={60}
                onChange={(e) => change(r.id, { label: e.target.value })}
                style={input}
                aria-label={`Field ${i + 1} label`}
              />
              {r.builtIn && <span style={{ fontSize: 10.5 }}>Built in — saved on the customer record</span>}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--color-neutral-700)" }}>
              Answer
              <select
                value={r.kind}
                disabled={r.builtIn}
                onChange={(e) => change(r.id, { kind: e.target.value as FieldKind })}
                style={input}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 12, color: "var(--color-text)" }}>
                <input
                  type="checkbox"
                  checked={r.required}
                  disabled={r.key === "name"}
                  onChange={(e) => change(r.id, { required: e.target.checked })}
                />
                Required
              </span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--color-neutral-700)" }}>
              {r.kind === "choice" ? "Options, separated by commas" : `Hint for ${agentName}`}
              {r.kind === "choice" ? (
                <input
                  value={r.optionsText}
                  onChange={(e) => change(r.id, { optionsText: e.target.value })}
                  placeholder="Laundry, Dry-cleaning, Curtains"
                  style={input}
                />
              ) : null}
              <input
                value={r.hint ?? ""}
                maxLength={200}
                onChange={(e) => change(r.id, { hint: e.target.value })}
                placeholder={r.kind === "choice" ? `Hint for ${agentName} (optional)` : "e.g. Flat, building and sector"}
                style={input}
              />
            </label>
            <div style={{ display: "flex", gap: 4, paddingTop: 16 }}>
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} style={small}>
                ↑
              </button>
              <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} style={small}>
                ↓
              </button>
              {!PERMANENT.has(r.key) && (
                <button
                  type="button"
                  onClick={() => {
                    setRows((all) => all.filter((x) => x.id !== r.id));
                    setDirty(true);
                    setSaved(false);
                  }}
                  style={{ ...small, color: "var(--color-accent-700)" }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            setRows((all) => [
              ...all,
              toRow({ key: "", label: "", hint: null, kind: "text", options: [], required: false, builtIn: false }),
            ]);
            setDirty(true);
            setSaved(false);
          }}
          style={small}
        >
          + Add a detail
        </button>
        <span style={{ flex: 1 }} />
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
            {error}
          </span>
        )}
        {saved && !dirty && <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>Saved — {agentName} uses it from the next message.</span>}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!window.confirm("Replace this list with your industry's starting list?")) return;
              setError(null);
              try {
                setRows((await onReset()).map(toRow));
                setDirty(false);
                setSaved(true);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Could not reset.");
              }
            })
          }
          style={small}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={save}
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "9px 16px",
            background: dirty ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            cursor: dirty && !pending ? "pointer" : "default",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
