"use client";

import { useEffect, useRef, useState, useTransition } from "react";

export type Availability = "available" | "busy" | "offline";

export type ProfileOption = {
  id: string;
  name: string;
  role: string;
  availability: Availability;
  rating?: number | null;
};

const AVAILABILITY: Record<Availability, { label: string; colour: string }> = {
  available: { label: "Available", colour: "var(--color-accent)" },
  busy: { label: "On a call", colour: "var(--color-neutral-700)" },
  offline: { label: "Away", colour: "var(--color-neutral-400)" },
};

const title = (role: string) => `${role[0].toUpperCase()}${role.slice(1)}`;

/**
 * The top of every screen: whether you can be handed a call, and who you are
 * looking at the console as.
 *
 * Availability is stated, never inferred — routing reads what the person
 * said, not what the console guessed — so it sits where it is seen, not at
 * the bottom of the sidebar.
 *
 * "View as" lets an owner open the console as one of their test accounts, to
 * check what each role sees (lib/auth/view-as.ts). In demo mode the same menu
 * switches between the demo team.
 */
export function HeaderControls({
  me,
  availability,
  canTakeCalls,
  onSetAvailability,
  viewAs,
  demo,
}: {
  me: { id: string; name: string; role: string };
  availability: Availability;
  canTakeCalls: boolean;
  onSetAvailability: (a: Availability) => Promise<void>;
  /** For an owner, or while viewing as a test account. */
  viewAs: {
    realName: string;
    viewing: boolean;
    accounts: ProfileOption[];
    onViewAs: (membershipId: string | null) => Promise<void>;
    onCreate: () => Promise<string[]>;
  } | null;
  /** Demo mode's switcher between the seeded team. */
  demo: { profiles: ProfileOption[]; onSwitch: (membershipId: string) => Promise<void> } | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    start(async () => {
      try {
        await fn();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");
      }
    });
  };

  const switchable = Boolean(viewAs) || Boolean(demo && demo.profiles.length > 1);
  const option = { width: "100%", padding: "8px 14px", textAlign: "left", display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 } as const;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {canTakeCalls && (
        <div role="group" aria-label="Your availability" className="cv-avail" style={{ display: "flex", gap: 2 }}>
          {(["available", "busy", "offline"] as const).map((state) => {
            const on = availability === state;
            return (
              <button
                key={state}
                type="button"
                aria-pressed={on}
                disabled={pending}
                onClick={() => run(() => onSetAvailability(state))}
                aria-label={AVAILABILITY[state].label}
                title={state === "available" ? "You can be handed calls and chats" : state === "busy" ? "On a call — nothing new is routed to you" : "Away — nothing is routed to you"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "5px 8px",
                  border: `1px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
                  background: on ? "var(--color-text)" : "transparent",
                  color: on ? "var(--color-bg)" : "var(--color-neutral-700)",
                  cursor: pending ? "progress" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 6, height: 6, background: on ? AVAILABILITY[state].colour : "var(--color-neutral-400)" }} />
                {/* On a phone the header has room for the dots only; the title says which. */}
                <span className="m-hide">{AVAILABILITY[state].label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div ref={box} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={switchable ? () => setOpen((v) => !v) : undefined}
          aria-haspopup={switchable ? "listbox" : undefined}
          aria-expanded={switchable ? open : undefined}
          disabled={!switchable || pending}
          className={switchable ? "hov-raise" : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "4px 8px",
            border: `1px solid ${viewAs?.viewing ? "var(--color-accent)" : "var(--color-neutral-400)"}`,
            background: viewAs?.viewing ? "var(--color-accent-100)" : "transparent",
            cursor: switchable ? "pointer" : "default",
            fontSize: 11.5,
            whiteSpace: "nowrap",
          }}
        >
          <span className="m-hide" style={{ fontWeight: 700 }}>{viewAs?.viewing ? `Viewing as ${me.name}` : me.name}</span>
          {/* A phone's header has room for initials only. */}
          <span className="m-only" style={{ fontWeight: 700 }}>
            {me.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}
          </span>
          <span className="m-hide" style={{ color: "var(--color-neutral-700)" }}>{title(me.role)}</span>
          {switchable && <span style={{ fontSize: 9, color: "var(--color-neutral-700)" }}>{open ? "▴" : "▾"}</span>}
        </button>

        {open && (
          <ul
            role="listbox"
            aria-label="Look at the console as"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 50,
              minWidth: 250,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            <li style={{ padding: "8px 14px 6px", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-neutral-500)", borderBottom: "1px solid var(--color-neutral-300)" }}>
              Look at the console as
            </li>

            {viewAs && (
              <>
                <li>
                  <button type="button" role="option" aria-selected={!viewAs.viewing} className="hov-raise" onClick={() => run(() => viewAs.onViewAs(null))} style={option}>
                    <span style={{ flex: 1 }}>
                      <b>{viewAs.realName}</b> <span style={{ color: "var(--color-neutral-700)" }}>· you, Owner</span>
                    </span>
                  </button>
                </li>
                {viewAs.accounts.map((a) => (
                  <li key={a.id}>
                    <button type="button" role="option" aria-selected={viewAs.viewing && a.id === me.id} className="hov-raise" onClick={() => run(() => viewAs.onViewAs(a.id))} style={option}>
                      <span style={{ width: 6, height: 6, flexShrink: 0, background: AVAILABILITY[a.availability].colour }} />
                      <span style={{ flex: 1, fontWeight: viewAs.viewing && a.id === me.id ? 700 : 500 }}>{a.name}</span>
                      <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>{title(a.role)}</span>
                    </button>
                  </li>
                ))}
                {viewAs.accounts.length < 4 && (
                  <li style={{ borderTop: "1px solid var(--color-neutral-300)" }}>
                    <button type="button" className="hov-raise" onClick={() => run(viewAs.onCreate)} style={{ ...option, fontWeight: 700, color: "var(--color-accent-700)" }}>
                      {viewAs.accounts.length ? "+ Add the missing test accounts" : "+ Create test accounts (Admin, Manager, Agent, Analyst)"}
                    </button>
                  </li>
                )}
                <li style={{ padding: "6px 14px 9px", fontSize: 10.5, color: "var(--color-neutral-700)", lineHeight: 1.4 }}>
                  Test accounts never get leads or seats; they are only rung for a call when set to Available.
                </li>
              </>
            )}

            {!viewAs &&
              demo?.profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === me.id}
                    className="hov-raise"
                    onClick={() => (p.id === me.id ? setOpen(false) : run(() => demo.onSwitch(p.id)))}
                    style={option}
                  >
                    <span style={{ width: 6, height: 6, flexShrink: 0, background: AVAILABILITY[p.availability].colour }} />
                    <span style={{ flex: 1, fontWeight: p.id === me.id ? 700 : 500 }}>{p.name}</span>
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                      {title(p.role)}
                      {p.rating != null && ` · ${p.rating.toFixed(1)}★`}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {error && (
          <span role="alert" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", fontSize: 11, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
