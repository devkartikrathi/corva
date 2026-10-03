"use client";

import { useState, useTransition } from "react";

const field = { border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0, minWidth: 0 } as const;
const small = { fontSize: 11, fontWeight: 700, border: "1px solid var(--color-neutral-400)", padding: "5px 9px", cursor: "pointer", background: "var(--color-bg)" } as const;
const primary = { fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px", cursor: "pointer" } as const;
const errorText = (e: unknown) => (e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");

/** The two safeguards on the assistant taking payment. */
export function PaymentPolicy({
  current,
  canEdit,
  onSave,
}: {
  current: { approvalRequired: boolean; verifyFirst: boolean };
  canEdit: boolean;
  onSave: (p: { approvalRequired: boolean; verifyFirst: boolean }) => Promise<void>;
}) {
  const [p, setP] = useState(current);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (key: keyof typeof p) => {
    const next = { ...p, [key]: !p[key] };
    setP(next);
    setNote(null);
    start(async () => {
      try {
        await onSave(next);
        setNote("Saved.");
      } catch (e) {
        setP(p);
        setNote(errorText(e));
      }
    });
  };
  const row = (key: keyof typeof p, label: string, help: string) => (
    <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, cursor: canEdit ? "pointer" : "default" }}>
      <input type="checkbox" checked={p[key]} disabled={!canEdit || pending} onChange={() => toggle(key)} style={{ marginTop: 3 }} />
      <span>
        <b>{label}</b>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>{help}</span>
      </span>
    </label>
  );
  return (
    <div style={{ display: "grid", gap: 10, margin: "0 0 14px" }}>
      {row(
        "approvalRequired",
        "A person approves each payment link the AI asks for",
        "The AI tells the customer the team will send the link; the request waits on the Handoffs screen. Switch off to let the AI send links itself.",
      )}
      {row(
        "verifyFirst",
        "The customer proves who they are before the AI asks for payment",
        "Unless they are on WhatsApp, a real call or an email they wrote from, the AI first sends a code to the number or email on file.",
      )}
      {note && <span style={{ fontSize: 11.5 }}>{note}</span>}
    </div>
  );
}

type OfferRow = { id: string; code: string; title: string; describe: string; active: boolean; uses: number };

/** Published offers: the only discounts the AI may ever give. */
export function OffersEditor({
  offers,
  segments,
  canEdit,
  onSave,
  onActive,
}: {
  offers: OfferRow[];
  segments: string[];
  canEdit: boolean;
  onSave: (o: {
    code: string;
    title: string;
    kind: string;
    value: number;
    maxDiscountRupees: number | null;
    minOrderRupees: number | null;
    firstOrderOnly: boolean;
    oncePerCustomer: boolean;
    excludeSegments: string[];
    endsAt: string | null;
  }) => Promise<void>;
  onActive: (id: string, active: boolean) => Promise<void>;
}) {
  const blank = { code: "", title: "", kind: "percent", value: "", max: "", min: "", firstOrderOnly: false, oncePerCustomer: true, exclude: [] as string[], endsAt: "" };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const num = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {offers.length === 0 && <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>No offers. The AI gives no discounts at all.</span>}
      {offers.map((o) => (
        <div key={o.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 12.5, opacity: o.active ? 1 : 0.55 }}>
          <code style={{ fontWeight: 800 }}>{o.code}</code>
          <span>
            <b>{o.title}</b> — {o.describe}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>used {o.uses}×</span>
          {canEdit && (
            <button type="button" style={small} disabled={pending} onClick={() => start(async () => onActive(o.id, !o.active))}>
              {o.active ? "Pause" : "Resume"}
            </button>
          )}
        </div>
      ))}
      {canEdit && !adding && (
        <button type="button" style={{ ...small, justifySelf: "start" }} onClick={() => setAdding(true)}>
          + Add an offer
        </button>
      )}
      {canEdit && adding && (
        <div style={{ border: "1px solid var(--color-neutral-300)", padding: 10, display: "grid", gap: 8, background: "var(--color-bg)" }}>
          <div className="m-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="CODE, e.g. FIRST20" aria-label="Code" style={{ ...field, width: 150 }} />
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What it is, e.g. 20% off your first order" aria-label="Title" style={{ ...field, flex: 1, minWidth: 200 }} />
          </div>
          <div className="m-wrap" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Kind" style={field}>
              <option value="percent">% off</option>
              <option value="flat">₹ off</option>
            </select>
            <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} inputMode="decimal" placeholder={f.kind === "percent" ? "20" : "100"} aria-label="How much off" style={{ ...field, width: 70 }} />
            {f.kind === "percent" && <input value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} inputMode="decimal" placeholder="Up to ₹" aria-label="Most it takes off, in rupees" style={{ ...field, width: 90 }} />}
            <input value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} inputMode="decimal" placeholder="Min order ₹" aria-label="Minimum order, in rupees" style={{ ...field, width: 100 }} />
            <label>
              Ends <input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} aria-label="Ends on" style={field} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={f.firstOrderOnly} onChange={(e) => setF({ ...f, firstOrderOnly: e.target.checked })} /> First order only
            </label>
            <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={f.oncePerCustomer} onChange={(e) => setF({ ...f, oncePerCustomer: e.target.checked })} /> Once per customer
            </label>
            {segments.map((seg) => (
              <label key={seg} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={f.exclude.includes(seg)}
                  onChange={(e) => setF({ ...f, exclude: e.target.checked ? [...f.exclude, seg] : f.exclude.filter((x) => x !== seg) })}
                />
                Not for {seg}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              disabled={pending || !f.code.trim() || !f.title.trim() || !f.value.trim()}
              style={primary}
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    await onSave({
                      code: f.code,
                      title: f.title,
                      kind: f.kind,
                      value: Number(f.value),
                      maxDiscountRupees: num(f.max),
                      minOrderRupees: num(f.min),
                      firstOrderOnly: f.firstOrderOnly,
                      oncePerCustomer: f.oncePerCustomer,
                      excludeSegments: f.exclude,
                      endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59+05:30`).toISOString() : null,
                    });
                    setF(blank);
                    setAdding(false);
                  } catch (e) {
                    setError(errorText(e));
                  }
                })
              }
            >
              {pending ? "Saving…" : "Publish offer"}
            </button>
            <button type="button" style={small} onClick={() => setAdding(false)}>
              Cancel
            </button>
            {error && (
              <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A payment link the AI asked for, waiting for a person. */
export function ApprovalCard({
  id,
  customer,
  orderReference,
  offer,
  identity,
  channel,
  requestedBy,
  at,
  conversationHref,
  onDecide,
}: {
  id: string;
  customer: string;
  orderReference: string;
  offer: string | null;
  identity: { verified: boolean; label: string };
  channel: string;
  requestedBy: string;
  at: string;
  conversationHref: string | null;
  onDecide: (id: string, approve: boolean) => Promise<{ status: string; amount?: string }>;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      setError(null);
      try {
        const r = await onDecide(id, approve);
        setDone(r.status === "approved" ? `Approved — ${r.amount ?? "the link"} sent.` : "Declined — the customer was told the team will be in touch.");
      } catch (e) {
        setError(errorText(e));
      }
    });
  return (
    <div style={{ border: "2px solid var(--color-text)", padding: "10px 12px", background: "var(--color-bg)", fontSize: 12.5, display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <b>{customer}</b>
        <span>wants to pay for</span>
        <code style={{ fontWeight: 800 }}>{orderReference}</code>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>{at}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-neutral-800)" }}>
        Asked by {requestedBy} on {channel} ·{" "}
        <span style={{ fontWeight: 700, color: identity.verified ? "var(--color-text)" : "var(--color-accent-700)" }}>{identity.label}</span>
        {offer && (
          <>
            {" "}· offer <b>{offer}</b> (checked)
          </>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
        Approving asks your payment system for the amount owed on this order{offer ? " with the offer" : ""}, then sends the link to the customer.
      </div>
      {done ? (
        <span style={{ fontWeight: 700 }}>{done}</span>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" disabled={pending} style={primary} onClick={() => decide(true)}>
            {pending ? "Working…" : "Approve & send link"}
          </button>
          <button type="button" disabled={pending} style={small} onClick={() => decide(false)}>
            Decline
          </button>
          {conversationHref && (
            <a href={conversationHref} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-700)" }}>
              Read the conversation →
            </a>
          )}
          {error && (
            <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
