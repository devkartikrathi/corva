"use client";

import { useState, useTransition } from "react";

/** The few controls Corva's admin screens need. Each runs a server action and shows what it said. */

const input = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
} as const;

const button = { fontSize: 12.5, fontWeight: 700, padding: "9px 14px", background: "var(--color-text)", color: "var(--color-bg)", cursor: "pointer" } as const;

const reason = (e: unknown) =>
  e instanceof Error && !e.message.startsWith("Minified React error") && !e.message.includes("NEXT_REDIRECT") ? e.message.replace(/^Error:\s*/, "") : null;

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    setDone(false);
    start(async () => {
      try {
        await fn();
        setDone(true);
      } catch (e) {
        // A redirect is how a successful action leaves the page.
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
        setError(reason(e) ?? "That did not work.");
      }
    });
  };
  return { error, done, pending, run };
}

export function PlanForm({
  slug,
  current,
  plans,
  onSet,
}: {
  slug: string;
  current: string;
  plans: { id: string; name: string; days: number }[];
  onSet: (slug: string, tier: string, days: number) => Promise<void>;
}) {
  const [tier, setTier] = useState(current);
  const [days, setDays] = useState(String(plans.find((p) => p.id === current)?.days ?? 30));
  const { error, done, pending, run } = useAction();
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={tier}
          onChange={(e) => {
            setTier(e.target.value);
            setDays(String(plans.find((p) => p.id === e.target.value)?.days ?? 30));
          }}
          style={input}
          aria-label="Plan"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12.5 }}>for</span>
        <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={{ ...input, width: 70 }} aria-label="Days" />
        <span style={{ fontSize: 12.5 }}>days from today</span>
        <button type="button" disabled={pending} onClick={() => run(() => onSet(slug, tier, Number(days)))} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
          {pending ? "Saving…" : "Set plan"}
        </button>
      </div>
      {done && <p style={{ margin: "8px 0 0", fontSize: 12 }}>Saved.</p>}
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-accent-700)" }}>{error}</p>}
    </div>
  );
}

export function RemoveBusiness({ slug, name, onRemove }: { slug: string; name: string; onRemove: (slug: string, confirm: string) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div>
      <div className="m-wrap" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type "${name}"`} className="m-full" style={{ ...input, width: 260 }} aria-label="Confirm the business name" />
        <button
          type="button"
          disabled={pending || typed.trim().toLowerCase() !== name.trim().toLowerCase()}
          onClick={() => run(() => onRemove(slug, typed))}
          style={{ ...button, background: "var(--color-accent)", opacity: pending || typed.trim().toLowerCase() !== name.trim().toLowerCase() ? 0.5 : 1 }}
        >
          {pending ? "Removing…" : "Remove this business"}
        </button>
      </div>
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-accent-700)" }}>{error}</p>}
    </div>
  );
}

export function StatusSelect({ id, value, options, onChange }: { id: string; value: string; options: string[]; onChange: (id: string, status: string) => Promise<void> }) {
  const { pending, run } = useAction();
  return (
    <select value={value} disabled={pending} onChange={(e) => run(() => onChange(id, e.target.value))} style={{ ...input, padding: "4px 6px", fontSize: 12 }} aria-label="Status">
      {options.map((o) => (
        <option key={o} value={o}>
          {o[0].toUpperCase() + o.slice(1)}
        </option>
      ))}
    </select>
  );
}

type NewBusiness = {
  businessName: string;
  industry: string;
  agentName: string;
  website: string;
  about: string;
  phoneNumber: string;
  ownerName: string;
  ownerEmail: string;
  team: string;
};

export function AddBusinessForm({ industries, onAdd }: { industries: { key: string; label: string }[]; onAdd: (input: NewBusiness) => Promise<void> }) {
  const { error, pending, run } = useAction();
  const label = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600 } as const;
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const get = (k: string) => String(d.get(k) ?? "");
        run(() =>
          onAdd({
            businessName: get("businessName"),
            industry: get("industry"),
            agentName: get("agentName"),
            website: get("website"),
            about: get("about"),
            phoneNumber: "",
            ownerName: get("ownerName"),
            ownerEmail: get("ownerEmail"),
            team: get("team"),
          }),
        );
      }}
    >
      <label style={label}>
        Business name
        <input name="businessName" required style={input} />
      </label>
      <label style={label}>
        Industry
        <select name="industry" defaultValue="general" style={input}>
          {industries.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <label style={label}>
        Website
        <input name="website" placeholder="www.example.com" style={input} />
      </label>
      <label style={label}>
        What the assistant should know
        <textarea name="about" rows={5} style={{ ...input, resize: "vertical", lineHeight: 1.5 }} />
      </label>
      <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <label style={label}>
          Assistant&rsquo;s name
          <input name="agentName" placeholder="Asha" style={input} />
        </label>
        <label style={label}>
          Owner&rsquo;s name
          <input name="ownerName" style={input} />
        </label>
        <label style={label}>
          Owner&rsquo;s email
          <input name="ownerEmail" type="email" required style={input} />
        </label>
      </div>
      <label style={label}>
        Team — one per line: Name, email, role
        <textarea name="team" rows={3} placeholder="Kavya Rao, kavya@example.com, manager" style={{ ...input, resize: "vertical", lineHeight: 1.5 }} />
      </label>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--color-accent-700)" }}>{error}</p>}
      <button type="submit" disabled={pending} style={{ ...button, padding: "12px 16px", fontSize: 13.5, opacity: pending ? 0.6 : 1 }}>
        {pending ? "Reading the website and setting up — about a minute…" : "Add the business and invite the owner"}
      </button>
    </form>
  );
}

/** Collected by Corva, for one brand: on/off, Corva's fee, where payouts go, and paying out. */
export function CollectionsForm({
  brandId,
  current,
  owed,
  onSave,
  onPayout,
}: {
  brandId: string;
  current: { enabled: boolean; feePercent: string; payoutNote: string; routeAccountId: string };
  owed: { owedLabel: string; payments: number };
  onSave: (brandId: string, input: { enabled: boolean; feePercent: string; payoutNote: string; routeAccountId: string }) => Promise<void>;
  onPayout: (brandId: string, reference: string) => Promise<void>;
}) {
  const [form, setForm] = useState(current);
  const [ref, setRef] = useState("");
  const save = useAction();
  const payout = useAction();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Collect for this business
        </label>
        <input value={form.feePercent} onChange={(e) => setForm({ ...form, feePercent: e.target.value })} inputMode="decimal" aria-label="Corva's fee, percent" placeholder="Fee %" style={{ ...input, width: 80 }} />
        <input value={form.payoutNote} onChange={(e) => setForm({ ...form, payoutNote: e.target.value })} aria-label="Where payouts go" placeholder="Payouts to: UPI / bank" style={{ ...input, width: 210 }} />
        <input value={form.routeAccountId} onChange={(e) => setForm({ ...form, routeAccountId: e.target.value })} aria-label="Razorpay Route account" placeholder="Route acc_… (later)" style={{ ...input, width: 170 }} />
        <button type="button" disabled={save.pending} onClick={() => save.run(() => onSave(brandId, form))} style={button}>
          {save.pending ? "Saving…" : "Save"}
        </button>
        {save.done && <span style={{ fontSize: 12 }}>Saved.</span>}
        {save.error && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>{save.error}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span>
          Owed to the business: <b>{owed.owedLabel}</b> from {owed.payments} payment{owed.payments === 1 ? "" : "s"}
        </span>
        {owed.payments > 0 && (
          <>
            <input value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Payout reference" placeholder="UTR / UPI ref of the payout" style={{ ...input, width: 220 }} />
            <button type="button" disabled={payout.pending || !ref.trim()} onClick={() => payout.run(() => onPayout(brandId, ref))} style={button}>
              {payout.pending ? "Recording…" : "Record payout"}
            </button>
          </>
        )}
        {payout.error && <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>{payout.error}</span>}
      </div>
    </div>
  );
}
