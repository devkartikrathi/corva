"use client";

import { useState, useTransition } from "react";
import type { OnboardingResult } from "@/lib/actions/onboarding";

/**
 * Creating a company.
 *
 * The form ends in an invite link rather than a success message, because the
 * link is the only part anyone needs afterwards — a workspace with no Owner in
 * it is not yet a customer.
 */
const PLANS = [
  { value: "trial", label: "Trial — no charge" },
  { value: "studio", label: "Studio — £29/seat" },
  { value: "operator", label: "Operator — £39/seat" },
  { value: "enterprise", label: "Enterprise — £55/seat + £1,200" },
];

const REGIONS = ["eu-west-2", "eu-west-1", "us-east-1", "ap-southeast-2"];

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

export function OnboardCompany({
  onOnboard,
}: {
  onOnboard: (input: {
    companyName: string;
    plan: string;
    region: string;
    seats: number;
    brandName: string;
    ownerName: string;
    ownerEmail: string;
  }) => Promise<OnboardingResult>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [plan, setPlan] = useState("trial");
  const [region, setRegion] = useState("eu-west-2");
  const [seats, setSeats] = useState("5");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const inviteUrl = result
    ? `${typeof window === "undefined" ? "" : window.location.origin}/invite/${result.inviteToken}`
    : "";

  if (result) {
    return (
      <div style={{ maxWidth: 620 }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-accent-400)",
          }}
        >
          Workspace created
        </div>
        <h2 style={{ margin: "10px 0 0", fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}>
          {result.orgName}
        </h2>
        <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
          One brand (<b style={{ color: "var(--color-bg)" }}>{result.brandName}</b>), default opening
          hours and a cautious privacy position. No agent, no documents, no channels — those are
          theirs to decide.
        </p>
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
          Send this to <b style={{ color: "var(--color-bg)" }}>{result.ownerEmail}</b>. They become
          the Owner, and everyone else in that workspace is invited by them, not by us.
        </p>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 8,
            alignItems: "center",
            border: "1px solid var(--color-neutral-600)",
            padding: "9px 11px",
          }}
        >
          <code style={{ flex: 1, fontSize: 11.5, color: "var(--color-bg)", wordBreak: "break-all" }}>
            {inviteUrl}
          </code>
          <button
            type="button"
            className="hov-accent-dark"
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            style={{
              fontSize: 11,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "5px 10px",
              flexShrink: 0,
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <a
            href={`/operator/companies/${result.orgSlug}`}
            className="hov-accent-dark"
            style={{
              fontSize: 12,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "10px 14px",
            }}
          >
            Open the account
          </a>
          <button
            type="button"
            className="hov-invert-dark"
            onClick={() => {
              setResult(null);
              setCompanyName("");
              setBrandName("");
              setOwnerName("");
              setOwnerEmail("");
            }}
            style={{ fontSize: 12, fontWeight: 600, border: "2px solid var(--color-bg)", padding: "9px 14px" }}
          >
            Onboard another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label>
          <span style={labelStyle}>Company</span>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Aurelius Group"
            style={field}
          />
        </label>
        <label>
          <span style={labelStyle}>First brand</span>
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={companyName || "Aurelius Home"}
            style={field}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 0.8fr", gap: 12 }}>
        <label>
          <span style={labelStyle}>Plan</span>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} style={field}>
            {PLANS.map((p) => (
              <option key={p.value} value={p.value} style={{ color: "var(--color-text)" }}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Residency</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} style={field}>
            {REGIONS.map((r) => (
              <option key={r} value={r} style={{ color: "var(--color-text)" }}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Seats</span>
          <input
            value={seats}
            onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            style={{ ...field, textAlign: "right" }}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label>
          <span style={labelStyle}>Owner</span>
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Priya Chandrasekaran"
            style={field}
          />
        </label>
        <label>
          <span style={labelStyle}>Owner email</span>
          <input
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="priya@company.com"
            style={field}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || !companyName.trim() || !ownerEmail.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                setResult(
                  await onOnboard({
                    companyName,
                    plan,
                    region,
                    seats: Number(seats) || 1,
                    brandName,
                    ownerName,
                    ownerEmail,
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 12,
            fontWeight: 700,
            background:
              companyName.trim() && ownerEmail.trim() ? "var(--color-accent)" : "var(--color-neutral-700)",
            color: "var(--color-bg)",
            padding: "11px 16px",
          }}
        >
          {pending ? "Creating…" : "Create the workspace"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--color-neutral-500)", lineHeight: 1.45 }}>
          Creates the company, one brand and an Owner invite. Nothing goes live until they
          publish an agent and a document.
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
