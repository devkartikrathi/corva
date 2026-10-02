"use client";

import { useState, useTransition } from "react";

/** The demo request form on the public site. */

const field = {
  width: "100%",
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
} as const;
const label = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--color-neutral-800)" } as const;

type Input = { name: string; email: string; phone: string; business: string; industry: string; website: string; message: string; company_url?: string };

export function DemoForm({
  industries,
  onRequest,
}: {
  industries: string[];
  onRequest: (input: Input) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div role="status" style={{ border: "2px solid var(--color-text)", padding: "22px 24px", maxWidth: 520 }}>
        <b style={{ fontSize: 18 }}>Thank you — we have it.</b>
        <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-800)" }}>
          Someone from Corva will write to you, usually within a working day, to find a time. If you would rather look around first, you can{" "}
          <a href="/sign-up" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
            start a free pilot
          </a>{" "}
          now.
        </p>
      </div>
    );
  }

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        const get = (k: string) => String(d.get(k) ?? "");
        setError(null);
        start(async () => {
          try {
            const result = await onRequest({
              name: get("name"),
              email: get("email"),
              phone: get("phone"),
              business: get("business"),
              industry: get("industry"),
              website: get("website"),
              message: get("message"),
              company_url: get("company_url"),
            });
            if (result.ok) setSent(true);
            else setError(result.error);
          } catch {
            setError("That did not go through. Please try again.");
          }
        });
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label style={label}>
          Your name
          <input name="name" required maxLength={80} style={field} autoComplete="name" />
        </label>
        <label style={label}>
          Work email
          <input name="email" type="email" required maxLength={120} style={field} autoComplete="email" />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label style={label}>
          Phone <span style={{ fontWeight: 400 }}>(optional)</span>
          <input name="phone" maxLength={30} style={field} autoComplete="tel" inputMode="tel" />
        </label>
        <label style={label}>
          Business name
          <input name="business" maxLength={120} style={field} autoComplete="organization" />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label style={label}>
          What kind of business?
          <select name="industry" defaultValue="" style={field}>
            <option value="">Choose…</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label style={label}>
          Website <span style={{ fontWeight: 400 }}>(optional)</span>
          <input name="website" maxLength={200} style={field} placeholder="www.yourbusiness.com" />
        </label>
      </div>
      <label style={label}>
        What would you like the assistant to do for you?
        <textarea name="message" rows={4} maxLength={2000} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
      </label>
      {/* Hidden from people; a script that fills every field gives itself away. */}
      <input name="company_url" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--color-accent-700)" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="hov-accent"
        style={{ fontSize: 14, fontWeight: 700, padding: "14px 20px", background: "var(--color-accent)", color: "var(--color-bg)", cursor: pending ? "progress" : "pointer", opacity: pending ? 0.7 : 1 }}
      >
        {pending ? "Sending…" : "Request a demo →"}
      </button>
    </form>
  );
}
