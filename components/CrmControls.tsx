"use client";

import { useState, useTransition, type CSSProperties } from "react";

/**
 * The small controls the CRM screens are made of.
 *
 * Every one of them runs a server action and shows what the server said when
 * it refuses — an Agent moving someone else's lead should read why, not watch
 * the select snap back without explanation.
 */

const errorStyle: CSSProperties = { fontSize: 11, color: "var(--color-accent-700)", lineHeight: 1.4 };

const inputStyle: CSSProperties = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  borderRadius: 0,
};

const message = (e: unknown) =>
  e instanceof Error && !e.message.startsWith("Minified React error")
    ? e.message.replace(/^Error:\s*/, "")
    : "That did not work. Refresh and try again.";

/** A select whose change is a server action. */
export function ActionSelect({
  value,
  options,
  onChange,
  label,
  style,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => Promise<unknown>;
  label: string;
  style?: CSSProperties;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(value);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const before = current;
          setCurrent(next);
          setError(null);
          start(async () => {
            try {
              await onChange(next);
            } catch (err) {
              setCurrent(before);
              setError(message(err));
            }
          });
        }}
        style={{ ...inputStyle, padding: "4px 6px", fontSize: 11.5, opacity: pending ? 0.6 : 1, ...style }}
      >
        {!options.some((o) => o.value === current) && <option value={current}>—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span style={errorStyle}>{error}</span>}
    </span>
  );
}

/** Done / later / reopen on one follow-up. */
export function FollowUpButtons({
  open,
  onDone,
  onPostpone,
  onReopen,
}: {
  open: boolean;
  onDone: (outcome: string) => Promise<unknown>;
  onPostpone: () => Promise<unknown>;
  onReopen: () => Promise<unknown>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noting, setNoting] = useState(false);
  const [outcome, setOutcome] = useState("");

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    start(async () => {
      try {
        await fn();
        setNoting(false);
      } catch (err) {
        setError(message(err));
      }
    });
  };

  const btn: CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: "5px 9px",
    border: "1px solid var(--color-text)",
    opacity: pending ? 0.5 : 1,
    whiteSpace: "nowrap",
  };

  if (!open) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
        <button type="button" className="hov-invert" disabled={pending} onClick={() => run(onReopen)} style={btn}>
          Reopen
        </button>
        {error && <span style={errorStyle}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      {noting ? (
        <span style={{ display: "flex", gap: 4 }}>
          <input
            autoFocus
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(() => onDone(outcome))}
            placeholder="What happened? (optional)"
            style={{ ...inputStyle, width: 190 }}
          />
          <button
            type="button"
            className="hov-accent"
            disabled={pending}
            onClick={() => run(() => onDone(outcome))}
            style={{ ...btn, background: "var(--color-accent)", color: "var(--color-bg)", border: "none" }}
          >
            Save
          </button>
        </span>
      ) : (
        <span style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="hov-accent"
            disabled={pending}
            onClick={() => setNoting(true)}
            style={{ ...btn, background: "var(--color-accent)", color: "var(--color-bg)", border: "none" }}
          >
            Done
          </button>
          <button type="button" className="hov-invert" disabled={pending} onClick={() => run(onPostpone)} style={btn}>
            +1 day
          </button>
        </span>
      )}
      {error && <span style={errorStyle}>{error}</span>}
    </span>
  );
}

/** Tomorrow at 10:00 in the browser's zone, as a datetime-local value. */
function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

/** A disclosure with a small form in it. */
function Disclosure({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="hov-accent"
        onClick={() => setOpen(true)}
        style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "9px 13px" }}
      >
        {label}
      </button>
    );
  }
  return <>{children(() => setOpen(false))}</>;
}

export function AddLeadForm({
  members,
  canAssign,
  onCreate,
}: {
  members: { id: string; name: string }[];
  canAssign: boolean;
  onCreate: (input: {
    name: string;
    phone: string;
    interest: string;
    valueRupees: number | null;
    ownerMembershipId?: string;
  }) => Promise<unknown>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", phone: "", interest: "", value: "", owner: "" });
  return (
    <Disclosure label="+ Add a lead">
      {(close) => (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            border: "1px solid var(--color-neutral-400)",
            padding: 8,
            background: "var(--color-surface)",
          }}
        >
          <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ ...inputStyle, width: 140 }} />
          <input placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={{ ...inputStyle, width: 130 }} />
          <input placeholder="What they want" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} style={{ ...inputStyle, width: 200 }} />
          <input placeholder="Value ₹" inputMode="numeric" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^0-9]/g, "") })} style={{ ...inputStyle, width: 80 }} />
          {canAssign && (
            <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} style={inputStyle} aria-label="Owner">
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="hov-accent"
            disabled={pending || !f.name.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                try {
                  await onCreate({
                    name: f.name,
                    phone: f.phone,
                    interest: f.interest,
                    valueRupees: f.value ? Number(f.value) : null,
                    ownerMembershipId: f.owner || undefined,
                  });
                  setF({ name: "", phone: "", interest: "", value: "", owner: "" });
                  close();
                } catch (err) {
                  setError(message(err));
                }
              });
            }}
            style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px" }}
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={close} style={{ fontSize: 12, padding: "7px 6px", color: "var(--color-neutral-700)" }}>
            Cancel
          </button>
          {error && <span style={{ ...errorStyle, width: "100%" }}>{error}</span>}
        </div>
      )}
    </Disclosure>
  );
}

export function AddFollowUpForm({
  onAdd,
  members,
  canAssign,
  label = "+ Add a follow-up",
}: {
  onAdd: (input: { title: string; due: string; assigneeMembershipId: string | null }) => Promise<unknown>;
  members?: { id: string; name: string }[];
  canAssign?: boolean;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState("");
  return (
    <Disclosure label={label}>
      {(close) => (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            border: "1px solid var(--color-neutral-400)",
            padding: 8,
            background: "var(--color-surface)",
          }}
        >
          <input
            autoFocus
            placeholder="What needs doing, e.g. Call back with the price"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...inputStyle, width: 260 }}
          />
          <input
            type="datetime-local"
            value={due || tomorrowMorning()}
            onChange={(e) => setDue(e.target.value)}
            style={inputStyle}
            aria-label="Due"
          />
          {canAssign && members && (
            <select value={who} onChange={(e) => setWho(e.target.value)} style={inputStyle} aria-label="Who">
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="hov-accent"
            disabled={pending || !title.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                try {
                  // datetime-local has no zone; the browser's is the person's.
                  await onAdd({ title, due: new Date(due || tomorrowMorning()).toISOString(), assigneeMembershipId: who || null });
                  setTitle("");
                  setDue("");
                  close();
                } catch (err) {
                  setError(message(err));
                }
              });
            }}
            style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px" }}
          >
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={close} style={{ fontSize: 12, padding: "7px 6px", color: "var(--color-neutral-700)" }}>
            Cancel
          </button>
          {error && <span style={{ ...errorStyle, width: "100%" }}>{error}</span>}
        </div>
      )}
    </Disclosure>
  );
}

/** Value and notes on a lead — the two things a person learns after the AI wrote it. */
export function LeadEditor({
  valueRupees,
  notes,
  onSave,
}: {
  valueRupees: number | null;
  notes: string | null;
  onSave: (input: { valueRupees: number | null; notes: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(valueRupees ? String(valueRupees) : "");
  const [text, setText] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hov-invert"
        style={{ fontSize: 11, fontWeight: 600, border: "1px solid var(--color-neutral-400)", padding: "4px 8px" }}
      >
        Edit
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", gap: 4 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="Value ₹"
          inputMode="numeric"
          aria-label="Value in rupees"
          style={{ ...inputStyle, width: 90 }}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Notes"
          aria-label="Notes"
          style={{ ...inputStyle, width: 220 }}
        />
        <button
          type="button"
          className="hov-accent"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onSave({ valueRupees: value ? Number(value) : null, notes: text });
                setOpen(false);
              } catch (e) {
                setError(message(e));
              }
            });
          }}
          style={{ fontSize: 11, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "0 10px" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
          Cancel
        </button>
      </span>
      {error && <span style={errorStyle}>{error}</span>}
    </span>
  );
}
