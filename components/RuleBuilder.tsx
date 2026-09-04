"use client";

import { useState, useTransition } from "react";

/**
 * Writing an override rule.
 *
 * Fields and comparisons come from a closed list rather than free text,
 * because the scoring engine looks these names up — a typo would produce a
 * rule that silently never fires, and a rule that never fires is invisible
 * exactly where the product promises visibility.
 */
export function RuleBuilder({
  fields,
  ops,
  actions,
  onCreate,
}: {
  fields: readonly { key: string; label: string; kind: string }[];
  ops: readonly string[];
  actions: readonly { kind: string; label: string }[];
  onCreate: (input: {
    name: string;
    effect: number;
    clauses: { field: string; op: string; value: string | number }[];
    actions: string[];
  }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [effect, setEffect] = useState("10");
  const [clauses, setClauses] = useState([{ field: fields[0].key, op: "gte", value: "" }]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const OP_LABEL: Record<string, string> = {
    eq: "is",
    contains: "contains",
    gte: "is at least",
    lte: "is at most",
    gt: "is more than",
    lt: "is less than",
  };

  const field = (i: number) => fields.find((f) => f.key === clauses[i].field);

  const set = (i: number, patch: Partial<(typeof clauses)[number]>) =>
    setClauses((c) => c.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const input: React.CSSProperties = {
    border: "1px solid var(--color-neutral-400)",
    background: "var(--color-surface)",
    padding: "5px 7px",
    fontSize: 12,
    fontFamily: "inherit",
    color: "var(--color-text)",
    borderRadius: 0,
  };

  if (!open) {
    return (
      <button
        type="button"
        className="hov-ink"
        onClick={() => setOpen(true)}
        style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-700)" }}
      >
        + New rule
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        width: "100%",
        border: "2px solid var(--color-text)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rule name — printed next to every score it moves"
          aria-label="Rule name"
          style={{ ...input, flex: 1, fontWeight: 700 }}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>points</span>
          <input
            value={effect}
            onChange={(e) => setEffect(e.target.value.replace(/[^0-9-]/g, ""))}
            aria-label="Points added or subtracted"
            style={{ ...input, width: 56, textAlign: "right" }}
          />
        </span>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
        {clauses.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--color-neutral-700)",
                width: 32,
              }}
            >
              {i === 0 ? "IF" : "AND"}
            </span>
            <select
              value={c.field}
              onChange={(e) => set(i, { field: e.target.value })}
              aria-label="Field"
              style={{ ...input, flex: 1 }}
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={c.op}
              onChange={(e) => set(i, { op: e.target.value })}
              aria-label="Comparison"
              style={{ ...input, width: 116 }}
            >
              {ops.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o] ?? o}
                </option>
              ))}
            </select>
            <input
              value={String(c.value)}
              onChange={(e) => set(i, { value: e.target.value })}
              inputMode={field(i)?.kind === "number" ? "numeric" : "text"}
              placeholder={field(i)?.kind === "number" ? "30" : "Tier 1"}
              aria-label="Value"
              style={{ ...input, width: 110 }}
            />
            {clauses.length > 1 && (
              <button
                type="button"
                className="hov-ink"
                onClick={() => setClauses((rows) => rows.filter((_, j) => j !== i))}
                aria-label="Remove condition"
                style={{ fontSize: 14, color: "var(--color-neutral-500)", lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="hov-ink"
          onClick={() => setClauses((rows) => [...rows, { field: fields[0].key, op: "gte", value: "" }])}
          style={{
            alignSelf: "flex-start",
            marginLeft: 38,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-accent-700)",
          }}
        >
          + condition
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--color-neutral-700)",
            width: 32,
          }}
        >
          THEN
        </span>
        {actions.map((a) => {
          const on = chosen.includes(a.kind);
          return (
            <button
              key={a.kind}
              type="button"
              onClick={() =>
                setChosen((c) => (on ? c.filter((k) => k !== a.kind) : [...c, a.kind]))
              }
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 8px",
                border: `1px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
                background: on ? "var(--color-text)" : "transparent",
                color: on ? "var(--color-bg)" : "var(--color-neutral-700)",
              }}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !name.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onCreate({
                  name,
                  effect: Number(effect),
                  clauses: clauses.map((c) => ({
                    field: c.field,
                    op: c.op,
                    value:
                      fields.find((f) => f.key === c.field)?.kind === "number"
                        ? Number(c.value)
                        : c.value,
                  })),
                  actions: chosen,
                });
                setOpen(false);
                setName("");
                setClauses([{ field: fields[0].key, op: "gte", value: "" }]);
                setChosen([]);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: name.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Saving and rescoring…" : "Create the rule"}
        </button>
        <button
          type="button"
          className="hov-ink"
          onClick={() => setOpen(false)}
          style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}
        >
          Cancel
        </button>
        <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>
          Every customer is rescored the moment this is saved.
        </span>
      </div>
      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
