"use client";

import { useState, useTransition } from "react";
import type { OnboardingResult } from "@/lib/actions/onboarding";

/**
 * Adding a business.
 *
 * Ends in the business's phone number and two buttons — ring it, or open its
 * console — because those are the two things anyone does next. Everything the
 * form asks for is something the owner already knows; nothing here is a
 * setting they would have to understand first.
 */

const field: React.CSSProperties = {
  border: "1px solid var(--color-neutral-600)",
  background: "transparent",
  color: "var(--color-bg)",
  padding: "8px 10px",
  fontSize: 12.5,
  fontFamily: "inherit",
  borderRadius: 0,
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-neutral-500)",
  display: "block",
  marginBottom: 6,
};

const hint: React.CSSProperties = {
  margin: "5px 0 0",
  fontSize: 11,
  color: "var(--color-neutral-500)",
  lineHeight: 1.45,
};

type Input = {
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

const EMPTY: Input = {
  businessName: "",
  industry: "general",
  agentName: "",
  website: "",
  about: "",
  phoneNumber: "",
  ownerName: "",
  ownerEmail: "",
  team: "",
};

export function OnboardCompany({
  onOnboard,
  onEnter,
  industries,
  demo,
}: {
  onOnboard: (input: Input) => Promise<OnboardingResult>;
  onEnter: (orgSlug: string) => Promise<void>;
  industries: { key: string; label: string }[];
  demo: boolean;
}) {
  const [form, setForm] = useState<Input>(EMPTY);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [entering, startEnter] = useTransition();

  const set = (key: keyof Input) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (result) {
    const inviteUrl =
      result.inviteToken && typeof window !== "undefined"
        ? `${window.location.origin}/invite/${result.inviteToken}`
        : null;
    return (
      <div style={{ maxWidth: 620 }}>
        <div style={{ ...labelStyle, color: "var(--color-accent-400)", marginBottom: 0 }}>Business is live</div>
        <h2 style={{ margin: "10px 0 0", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em" }}>
          {result.orgName}
        </h2>
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
          {result.industry} · {result.agentName} answers the phone · {result.people}{" "}
          {result.people === 1 ? "person" : "people"} on the team
        </p>

        <div style={{ marginTop: 16, border: "2px solid var(--color-accent)", padding: "14px 16px" }}>
          <div style={labelStyle}>Their number</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>{result.phoneNumber}</div>
          <p style={hint}>Dial it from Test calls — the call reaches {result.agentName}, and shows up in their console.</p>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, color: "var(--color-neutral-400)", lineHeight: 1.7 }}>
          <b style={{ color: "var(--color-bg)" }}>What the AI knows</b>
          {result.documents.map((d) => (
            <div key={d.title}>
              · {d.title} — {d.chunks} {d.chunks === 1 ? "passage" : "passages"}
            </div>
          ))}
        </div>

        {result.warnings.length > 0 && (
          <div
            style={{
              marginTop: 12,
              border: "1px solid var(--color-accent-800)",
              padding: "9px 11px",
              fontSize: 11.5,
              color: "var(--color-accent-400)",
              lineHeight: 1.5,
            }}
          >
            {result.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}

        {inviteUrl && (
          <p style={{ ...hint, marginTop: 12 }}>
            Owner invite for {result.ownerEmail}: <code style={{ color: "var(--color-bg)" }}>{inviteUrl}</code>
          </p>
        )}

        <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            href={`/operator/testing?dial=${encodeURIComponent(result.phoneNumber)}`}
            className="hov-accent-dark"
            style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "10px 14px" }}
          >
            Call {result.phoneNumber}
          </a>
          {demo && (
            <button
              type="button"
              className="hov-invert-dark"
              disabled={entering}
              onClick={() => startEnter(() => onEnter(result.orgSlug))}
              style={{ fontSize: 12, fontWeight: 700, border: "2px solid var(--color-bg)", padding: "9px 14px" }}
            >
              {entering ? "Opening…" : "Open their console"}
            </button>
          )}
          <button
            type="button"
            className="hov-invert-dark"
            onClick={() => {
              setResult(null);
              setForm(EMPTY);
            }}
            style={{ fontSize: 12, fontWeight: 600, border: "1px solid var(--color-neutral-600)", padding: "9px 14px" }}
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  const ready = form.businessName.trim() && form.ownerEmail.trim();

  return (
    <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <label>
          <span style={labelStyle}>Business name</span>
          <input value={form.businessName} onChange={set("businessName")} placeholder="Sunrise Dental Clinic" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Industry</span>
          <select value={form.industry} onChange={set("industry")} style={field}>
            {industries.map((i) => (
              <option key={i.key} value={i.key} style={{ color: "var(--color-text)" }}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <label>
          <span style={labelStyle}>Website</span>
          <input value={form.website} onChange={set("website")} placeholder="sunrisedental.in" style={field} />
          <p style={hint}>Read on creation — services, prices, hours and policies become what the AI knows.</p>
        </label>
        <label>
          <span style={labelStyle}>AI assistant&rsquo;s name</span>
          <input value={form.agentName} onChange={set("agentName")} placeholder="Asha" style={field} />
        </label>
      </div>

      <label>
        <span style={labelStyle}>Anything else the AI should know</span>
        <textarea
          value={form.about}
          onChange={set("about")}
          rows={5}
          placeholder={"Consultation: ₹500, waived if treatment is booked the same day.\nParking: Free parking in the basement.\nDoctors: Dr. Rao (Mon–Fri), Dr. Iyer (Sat)."}
          style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
        />
        <p style={hint}>One fact per line, &ldquo;Topic: detail&rdquo;. Prices, timings, policies, FAQs.</p>
      </label>

      <label>
        <span style={labelStyle}>Phone number</span>
        <input value={form.phoneNumber} onChange={set("phoneNumber")} placeholder="Leave blank for a test number" style={field} />
        <p style={hint}>The number customers ring. Blank gives it a free +91 40 7xxx xxxx test line.</p>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid var(--color-neutral-800)", paddingTop: 14 }}>
        <label>
          <span style={labelStyle}>Owner</span>
          <input value={form.ownerName} onChange={set("ownerName")} placeholder="Dr. Kavya Rao" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Owner email</span>
          <input value={form.ownerEmail} onChange={set("ownerEmail")} placeholder="kavya@sunrisedental.in" style={field} />
        </label>
      </div>

      <label>
        <span style={labelStyle}>Team (optional)</span>
        <textarea
          value={form.team}
          onChange={set("team")}
          rows={3}
          placeholder={"Ravi Kumar, ravi@sunrisedental.in, manager\nPooja Nair, pooja@sunrisedental.in, agent"}
          style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
        />
        <p style={hint}>&ldquo;Name, email, role&rdquo; per line — manager, agent or analyst. They take handoffs and own leads.</p>
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || !ready}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                setResult(await onOnboard(form));
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: ready ? "var(--color-accent)" : "var(--color-neutral-700)",
            color: "var(--color-bg)",
            padding: "11px 16px",
          }}
        >
          {pending ? "Setting up… (reading the website)" : "Create the business"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)", lineHeight: 1.45 }}>
          Creates the business, its AI assistant, what it knows, and its number. It can take calls straight away.
        </span>
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--color-accent-400)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
