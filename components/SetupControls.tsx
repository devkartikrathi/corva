"use client";

import { useState, useTransition } from "react";

/**
 * Setup forms.
 *
 * Three of these change what happens on a live call — a channel's state, a
 * brand going live, opening hours — so each one says what it will do before it
 * does it, and each surfaces the server's refusal rather than swallowing it.
 */

const field: React.CSSProperties = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "6px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
};

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

/* ─── Brands ───────────────────────────────────────────────────────────── */

export function AddBrand({
  onCreate,
}: {
  onCreate: (input: { name: string; segment: string; location: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [location, setLocation] = useState("");
  const { pending, error, run } = useAction();

  if (!open) {
    return (
      <button
        type="button"
        className="hov-accent"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          fontWeight: 700,
          background: "var(--color-accent)",
          color: "var(--color-bg)",
          padding: "10px 14px",
        }}
      >
        Add a brand
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        insetInlineEnd: 24,
        top: 68,
        zIndex: 30,
        width: 340,
        background: "var(--color-bg)",
        border: "2px solid var(--color-text)",
        padding: "16px 18px",
        boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" aria-label="Brand name" style={field} />
        <input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="Retail, Trade…" aria-label="Segment" style={field} />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="London" aria-label="Location" style={field} />
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
        It starts in setup with default opening hours, no channels and no agent. Nothing answers
        until you publish a version and a document.
      </p>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !name.trim()}
          onClick={() => run(() => onCreate({ name, segment, location }), () => { setOpen(false); setName(""); })}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: name.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button type="button" className="hov-ink" onClick={() => setOpen(false)} style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          Cancel
        </button>
      </div>
      <Err>{error}</Err>
    </div>
  );
}

export function BrandLiveToggle({
  brandId,
  live,
  name,
  onToggle,
}: {
  brandId: string;
  live: boolean;
  name: string;
  onToggle: (brandId: string, live: boolean) => Promise<unknown>;
}) {
  const { pending, error, run } = useAction();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
      <button
        type="button"
        className="hov-border"
        disabled={pending}
        onClick={() => {
          if (live && !window.confirm(`Take ${name} down? Its channels stop answering.`)) return;
          run(() => onToggle(brandId, !live));
        }}
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          border: "1px solid var(--color-neutral-400)",
          padding: "3px 8px",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Saving…" : live ? "Take down" : "Take live"}
      </button>
      <Err>{error}</Err>
    </span>
  );
}

/* ─── Channels ─────────────────────────────────────────────────────────── */

/**
 * The business's own phone number: one field, saved as it is typed.
 *
 * It is the number the assistant gives customers and the one Corva's test
 * dialer rings; it is not a telephone line into the assistant.
 */
export function PhoneNumberField({ number, onSave }: { number: string; onSave: (number: string) => Promise<unknown> }) {
  const [value, setValue] = useState(number);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();
  const changed = value.trim() !== number.trim();

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <span style={{ display: "flex", gap: 6 }}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="+91 98765 43210"
          aria-label="Business phone number"
          inputMode="tel"
          style={{ ...field, width: 190, padding: "5px 8px", fontSize: 12.5 }}
        />
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !changed}
          onClick={() => run(() => onSave(value.trim()), () => setSaved(true))}
          style={{ fontSize: 11, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "5px 11px", opacity: pending || !changed ? 0.5 : 1 }}
        >
          {pending ? "Saving…" : saved && !changed ? "Saved" : "Save"}
        </button>
      </span>
      <Err>{error}</Err>
    </span>
  );
}

/* ─── Hours ────────────────────────────────────────────────────────────── */

export function HoursRow({
  brandId,
  weekday,
  day,
  closed,
  opens,
  closes,
  onSave,
}: {
  brandId: string;
  weekday: number;
  day: string;
  closed: boolean;
  opens: number;
  closes: number;
  onSave: (
    brandId: string,
    weekday: number,
    input: { closed: boolean; opensMinute: number; closesMinute: number },
  ) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [isClosed, setClosed] = useState(closed);
  const [from, setFrom] = useState(opens);
  const [to, setTo] = useState(closes);
  const { pending, error, run } = useAction();

  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const toMinutes = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
      <span style={{ width: 96, color: "var(--color-neutral-800)" }}>{day}</span>
      {editing ? (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
            <input type="checkbox" checked={isClosed} onChange={(e) => setClosed(e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            Closed
          </label>
          {!isClosed && (
            <>
              <input type="time" value={hhmm(from)} onChange={(e) => setFrom(toMinutes(e.target.value))} aria-label="Opens" style={{ ...field, padding: "3px 5px", fontSize: 12 }} />
              <input type="time" value={hhmm(to)} onChange={(e) => setTo(toMinutes(e.target.value))} aria-label="Closes" style={{ ...field, padding: "3px 5px", fontSize: 12 }} />
            </>
          )}
          <button
            type="button"
            className="hov-accent"
            disabled={pending}
            onClick={() =>
              run(
                () => onSave(brandId, weekday, { closed: isClosed, opensMinute: from, closesMinute: to }),
                () => setEditing(false),
              )
            }
            style={{ fontSize: 10.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "3px 8px" }}
          >
            {pending ? "…" : "Save"}
          </button>
          <Err>{error}</Err>
        </>
      ) : (
        <>
          <b style={{ flex: 1 }}>{closed ? "Closed" : `${hhmm(opens)} – ${hhmm(closes)}`}</b>
          <button type="button" className="hov-ink" onClick={() => setEditing(true)} style={{ fontSize: 11, fontWeight: 700, color: "var(--color-accent-700)" }}>
            Change
          </button>
        </>
      )}
    </div>
  );
}

/* ─── Privacy ──────────────────────────────────────────────────────────── */

export type Privacy = {
  retentionDays: number;
  redactPii: boolean;
  trainOnTranscripts: boolean;
  recordCalls: boolean;
  allowSupportAccess: boolean;
  dpoEmail: string;
};

export function PrivacyForm({
  initial,
  region,
  onSave,
}: {
  initial: Privacy;
  region: string;
  onSave: (input: Privacy) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  const toggle = (key: keyof Privacy, label: string, help?: string) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 12.5 }}>
      <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
        {label}
        {help && (
          <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)", marginTop: 2 }}>
            {help}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(value[key])}
        aria-label={label}
        onClick={() => {
          setSaved(false);
          setValue((v) => ({ ...v, [key]: !v[key] }));
        }}
        style={{
          width: 34,
          height: 18,
          background: value[key] ? "var(--color-accent)" : "var(--color-neutral-400)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value[key] ? 18 : 2,
            width: 14,
            height: 14,
            background: "var(--color-bg)",
            display: "block",
            transition: "left 120ms ease",
          }}
        />
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
        <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>Transcript retention</span>
        <input
          value={String(value.retentionDays)}
          onChange={(e) => {
            setSaved(false);
            setValue((v) => ({ ...v, retentionDays: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 }));
          }}
          aria-label="Retention days"
          style={{ ...field, width: 68, padding: "4px 7px", textAlign: "right" }}
        />
        <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>days</span>
      </div>

      {toggle("redactPii", "Redact personal data before storage", "Card numbers, addresses and the like")}
      {toggle("recordCalls", "Record voice calls")}
      {toggle("trainOnTranscripts", "Let transcripts improve the shared model", "Off keeps everything in this tenant")}
      {toggle("allowSupportAccess", "Corva staff may request access", "Time-boxed, audited, visible to the Owner")}

      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
        <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>Data protection contact</span>
        <input
          value={value.dpoEmail}
          onChange={(e) => {
            setSaved(false);
            setValue((v) => ({ ...v, dpoEmail: e.target.value }));
          }}
          placeholder="privacy@company.com"
          aria-label="Data protection contact"
          style={{ ...field, width: 190, padding: "4px 7px" }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
        <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>Residency</span>
        <b>{region}</b>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !dirty}
          onClick={() => run(() => onSave(value), () => setSaved(true))}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: dirty ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Saved and audited.</span>}
        <Err>{error}</Err>
      </div>
    </div>
  );
}
