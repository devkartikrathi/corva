"use client";

import { useState, useTransition } from "react";

/**
 * Setting a business up, by its owner.
 *
 * Six fields, of which two matter: what the business is called, and where its
 * facts are — a website Corva can read, or a few lines typed here. The rest
 * have sensible defaults and can all be changed afterwards.
 */

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

export function WelcomeForm({
  industries,
  defaultName,
  onStart,
}: {
  industries: { key: string; label: string }[];
  defaultName: string;
  onStart: (input: {
    businessName: string;
    industry: string;
    website: string;
    about: string;
    agentName: string;
    ownerName: string;
  }) => Promise<{ error: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const get = (k: string) => String(data.get(k) ?? "");
        setError(null);
        start(async () => {
          // On success the action redirects into the console and never returns.
          const result = await onStart({
            businessName: get("businessName"),
            industry: get("industry"),
            website: get("website"),
            about: get("about"),
            agentName: get("agentName"),
            ownerName: get("ownerName"),
          });
          if (result?.error) setError(result.error);
        });
      }}
    >
      <label style={label}>
        Business name
        <input name="businessName" required maxLength={80} placeholder="Sunrise Dental Care" style={field} autoFocus />
      </label>
      <label style={label}>
        What kind of business is it?
        <select name="industry" defaultValue="general" style={field}>
          {industries.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
        <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          Sets what the assistant asks for, what it can book and the words your pipeline uses. All editable later.
        </span>
      </label>
      <label style={label}>
        Website
        <input name="website" maxLength={200} placeholder="www.yourbusiness.com" style={field} inputMode="url" />
        <span style={{ fontWeight: 400, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          Corva reads your services, prices and policies from it. No website? Describe the business below instead.
        </span>
      </label>
      <label style={label}>
        Anything the assistant should know
        <textarea
          name="about"
          rows={5}
          maxLength={12000}
          placeholder={"Opening hours: Mon–Sat 9 am – 7 pm\nConsultation fee: ₹500\nWe serve: Sector 40–60, Gurugram"}
          style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label style={label}>
          Name your assistant
          <input name="agentName" maxLength={30} placeholder="Asha" style={field} />
        </label>
        <label style={label}>
          Your name
          <input name="ownerName" maxLength={80} defaultValue={defaultName} style={field} />
        </label>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-accent-700)", fontWeight: 600 }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="hov-accent"
        style={{ fontSize: 14, fontWeight: 700, padding: "14px 20px", background: "var(--color-accent)", color: "var(--color-bg)", cursor: pending ? "progress" : "pointer", opacity: pending ? 0.75 : 1 }}
      >
        {pending ? "Reading your website and setting up — about a minute…" : "Create my assistant →"}
      </button>
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
        Free for 14 days: 100 chats and 30 voice minutes, no card needed. You can try the assistant straight away.
      </p>
    </form>
  );
}
