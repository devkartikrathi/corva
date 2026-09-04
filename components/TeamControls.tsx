"use client";

import { useState, useTransition } from "react";

/**
 * Inviting and re-scoping people.
 *
 * The role list is trimmed to what the person doing the inviting actually
 * holds, so the form cannot offer a choice the server will refuse. That check
 * still runs on the server — this only keeps the screen honest about it.
 */

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  analyst: "Analyst",
};

const field: React.CSSProperties = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "6px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
};

export function InvitePanel({
  roles,
  brands,
  onInvite,
}: {
  roles: string[];
  brands: { id: string; name: string }[];
  onInvite: (input: {
    email: string;
    name: string;
    role: string;
    brandIds: string[];
    allBrands: boolean;
  }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(roles[roles.length - 1] ?? "agent");
  const [allBrands, setAllBrands] = useState(false);
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
        Invite people
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        insetInlineEnd: 24,
        top: 72,
        zIndex: 30,
        width: 420,
        background: "var(--color-bg)",
        border: "2px solid var(--color-text)",
        padding: "16px 18px",
        boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
        textAlign: "left",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-neutral-700)",
        }}
      >
        Invite someone
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          aria-label="Email"
          style={field}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name (optional)"
          aria-label="Name"
          style={field}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" style={field}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={allBrands}
            onChange={(e) => setAllBrands(e.target.checked)}
            style={{ accentColor: "var(--color-accent)" }}
          />
          Every brand in the workspace
        </label>

        {!allBrands && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {brands.map((b) => {
              const on = brandIds.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() =>
                    setBrandIds((ids) => (on ? ids.filter((i) => i !== b.id) : [...ids, b.id]))
                  }
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "4px 9px",
                    border: `1px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
                    background: on ? "var(--color-text)" : "transparent",
                    color: on ? "var(--color-bg)" : "var(--color-neutral-700)",
                  }}
                >
                  {b.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          className="hov-accent"
          disabled={pending || !email.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onInvite({ email, name, role, brandIds, allBrands });
                setOpen(false);
                setEmail("");
                setName("");
                setBrandIds([]);
              } catch (e) {
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: email.trim() ? "var(--color-accent)" : "var(--color-neutral-400)",
            color: "var(--color-bg)",
            padding: "8px 13px",
          }}
        >
          {pending ? "Inviting…" : "Send the invite"}
        </button>
        <button
          type="button"
          className="hov-ink"
          onClick={() => setOpen(false)}
          style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The role cell in the people table. */
export function RoleSelect({
  membershipId,
  role,
  roles,
  disabled,
  onChange,
}: {
  membershipId: string;
  role: string;
  roles: string[];
  disabled: boolean;
  onChange: (membershipId: string, role: string) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (disabled) {
    return <span style={{ fontSize: 12.5 }}>{ROLE_LABELS[role] ?? role}</span>;
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
      <select
        value={role}
        disabled={pending}
        aria-label="Role"
        onChange={(e) => {
          const next = e.target.value;
          setError(null);
          start(async () => {
            try {
              await onChange(membershipId, next);
            } catch (err) {
              setError(err instanceof Error ? err.message.replace(/^Error:\s*/, "") : "Failed.");
            }
          });
        }}
        style={{ ...field, padding: "3px 5px", fontSize: 12, opacity: pending ? 0.6 : 1 }}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r] ?? r}
          </option>
        ))}
        {!roles.includes(role) && <option value={role}>{ROLE_LABELS[role] ?? role}</option>}
      </select>
      {error && (
        <span role="alert" style={{ fontSize: 10, color: "var(--color-accent-700)", maxWidth: "18ch" }}>
          {error}
        </span>
      )}
    </span>
  );
}
