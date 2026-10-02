"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { NavItem } from "@/lib/nav";
import { NAV_CLOSE_EVENT } from "./MobileNav";

export type BrandOption = { id: string; name: string; initials: string; isLive: boolean };

export type ProfileOption = {
  id: string;
  name: string;
  role: string;
  availability: "available" | "busy" | "offline";
  rating: number | null;
};

const AVAILABILITY: Record<ProfileOption["availability"], { label: string; colour: string }> = {
  available: { label: "Available", colour: "var(--color-accent)" },
  busy: { label: "On a call", colour: "var(--color-neutral-700)" },
  offline: { label: "Offline", colour: "var(--color-neutral-400)" },
};

export function Sidebar({
  brand,
  brands,
  orgName,
  userName,
  userRole,
  membershipId,
  availability,
  profiles,
  canSwitchProfile,
  canTakeCalls,
  counts,
  groups,
  onSwitchBrand,
  onSwitchProfile,
  onSetAvailability,
}: {
  brand: BrandOption;
  brands: BrandOption[];
  orgName: string;
  userName: string;
  userRole: string;
  membershipId: string;
  availability: ProfileOption["availability"];
  /** Everyone this workspace could be looked at as. Demo mode only. */
  profiles: ProfileOption[];
  canSwitchProfile: boolean;
  /** Whether this role can be handed a customer at all. */
  canTakeCalls: boolean;
  counts: { live: number; waiting: number };
  /** Already filtered to what this role may reach — see lib/nav.ts. */
  groups: { label: string; items: NavItem[] }[];
  onSwitchBrand: (brandId: string) => Promise<void>;
  onSwitchProfile: (membershipId: string) => Promise<void>;
  onSetAvailability: (availability: ProfileOption["availability"]) => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  const [changingWho, startWho] = useTransition();
  // On a small screen this is a drawer; see MobileNav.
  const closeDrawer = () => window.dispatchEvent(new Event(NAV_CLOSE_EVENT));

  return (
    <aside
      id="cv-sidebar"
      className="cv-sidebar"
      style={{
        borderRight: "2px solid var(--color-divider)",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "16px 16px 14px",
          borderBottom: "2px solid var(--color-divider)",
          display: "flex",
          alignItems: "baseline",
          gap: 7,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>CORVA</span>
        <span style={{ width: 7, height: 7, background: "var(--color-accent)", display: "block" }} />
        <button
          type="button"
          className="m-only"
          aria-label="Close menu"
          onClick={closeDrawer}
          style={{ marginLeft: "auto", fontSize: 20, lineHeight: 1, padding: "0 4px", alignSelf: "center" }}
        >
          ×
        </button>
      </div>

      {/* The brand switcher. Only brands this membership is scoped to appear
          here, and the server re-checks that on switch — the list is a
          convenience, not the authorization. */}
      <div style={{ position: "relative", borderBottom: "1px solid var(--color-neutral-300)" }}>
        <button
          type="button"
          className="hov-raise"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={switching}
          style={{
            width: "100%",
            padding: "12px 16px",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: switching ? 0.6 : 1,
            cursor: switching ? "progress" : "pointer",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              background: "var(--color-text)",
              color: "var(--color-bg)",
              fontWeight: 800,
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {brand.initials}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {brand.name}
            </span>
            <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
              {orgName}
            </span>
          </span>
          <span style={{ fontSize: 10, color: "var(--color-neutral-700)" }}>{open ? "▴" : "▾"}</span>
        </button>

        {open && (
          <ul
            role="listbox"
            style={{
              position: "absolute",
              insetInline: 0,
              top: "100%",
              zIndex: 40,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}
          >
            {brands.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b.id === brand.id}
                  className="hov-raise"
                  onClick={() => {
                    setOpen(false);
                    if (b.id === brand.id) return;
                    startSwitch(async () => {
                      await onSwitchBrand(b.id);
                    });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 14px",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 12.5,
                    fontWeight: b.id === brand.id ? 700 : 400,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      fontSize: 10,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: b.id === brand.id ? "var(--color-text)" : "var(--color-neutral-300)",
                      color: b.id === brand.id ? "var(--color-bg)" : "var(--color-neutral-800)",
                      flexShrink: 0,
                    }}
                  >
                    {b.initials}
                  </span>
                  <span style={{ flex: 1 }}>{b.name}</span>
                  {!b.isLive && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", color: "var(--color-neutral-700)" }}>
                      SETUP
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <nav style={{ flex: 1, padding: "10px 0 20px" }}>
        {groups.map((group, i) => (
          <div key={group.label}>
            <div
              style={{
                padding: i === 0 ? "12px 16px 6px" : "16px 16px 6px",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-500)",
              }}
            >
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="hov-raise"
                  onClick={closeDrawer}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  <span
                    style={{
                      width: 3,
                      height: 15,
                      display: "block",
                      background: active ? "var(--color-accent)" : "transparent",
                    }}
                  />
                  {item.label}
                  {item.badge && counts[item.badge.count] > 0 &&
                    (item.badge.accent ? (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--color-bg)",
                          background: "var(--color-accent)",
                          padding: "2px 6px",
                        }}
                      >
                        {counts[item.badge.count]}
                      </span>
                    ) : (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--color-text)",
                          border: "1px solid var(--color-neutral-400)",
                          padding: "1px 5px",
                        }}
                      >
                        {counts[item.badge.count]}
                      </span>
                    ))}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/*
        Who you are, and whether you can be handed a call.

        The switcher is the honest way to show that this console is two
        different jobs: a Manager sees the whole brand and how the team is
        doing; an Agent sees the customers they hold and the calls the AI hands
        them. Describing that is unconvincing — swapping between the two in a
        click is not. It only exists in demo mode; with Clerk on, this is a
        plain name and a role, because you are already somebody.
      */}
      <div style={{ position: "relative", borderTop: "2px solid var(--color-divider)" }}>
        {whoOpen && canSwitchProfile && (
          <ul
            role="listbox"
            aria-label="Look at the console as"
            style={{
              position: "absolute",
              insetInline: 0,
              bottom: "100%",
              zIndex: 40,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: "var(--color-bg)",
              border: "2px solid var(--color-text)",
              boxShadow: "0 -8px 24px rgba(0,0,0,0.12)",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            <li
              style={{
                padding: "8px 14px 6px",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-neutral-500)",
                borderBottom: "1px solid var(--color-neutral-300)",
              }}
            >
              Look at this as
            </li>
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === membershipId}
                  className="hov-raise"
                  onClick={() => {
                    setWhoOpen(false);
                    if (p.id === membershipId) return;
                    startWho(async () => {
                      await onSwitchProfile(p.id);
                    });
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 14px",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 12.5,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      flexShrink: 0,
                      background: AVAILABILITY[p.availability].colour,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: p.id === membershipId ? 700 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                      {p.role[0].toUpperCase()}
                      {p.role.slice(1)}
                      {p.rating !== null && ` · ${p.rating.toFixed(1)}★`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ padding: "10px 16px 12px" }}>
          <button
            type="button"
            className={canSwitchProfile ? "hov-raise" : undefined}
            onClick={canSwitchProfile ? () => setWhoOpen((v) => !v) : undefined}
            aria-expanded={canSwitchProfile ? whoOpen : undefined}
            aria-haspopup={canSwitchProfile ? "listbox" : undefined}
            disabled={!canSwitchProfile || changingWho}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              textAlign: "left",
              cursor: canSwitchProfile ? (changingWho ? "progress" : "pointer") : "default",
              opacity: changingWho ? 0.6 : 1,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                border: "2px solid var(--color-text)",
                fontWeight: 700,
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {userName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {userName}
              </span>
              <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
                {userRole}
              </span>
            </span>
            {canSwitchProfile && (
              <span style={{ fontSize: 10, color: "var(--color-neutral-700)" }}>
                {whoOpen ? "▾" : "▴"}
              </span>
            )}
          </button>

          {/*
            Availability is stated, never inferred. Someone at their desk
            writing a report is not available, and someone who has not clicked
            in ten minutes may well be mid-call — so routing reads what the
            person said, not what the console guessed.
          */}
          {canTakeCalls && (
            <div className="cv-avail" style={{ marginTop: 9, display: "flex", gap: 3 }}>
              {(["available", "busy", "offline"] as const).map((state) => {
                const on = availability === state;
                return (
                  <button
                    key={state}
                    type="button"
                    aria-pressed={on}
                    disabled={changingWho}
                    onClick={() =>
                      startWho(async () => {
                        await onSetAvailability(state);
                      })
                    }
                    style={{
                      flex: 1,
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: "4px 2px",
                      border: `1px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
                      background: on ? "var(--color-text)" : "transparent",
                      color: on ? "var(--color-bg)" : "var(--color-neutral-700)",
                      cursor: changingWho ? "progress" : "pointer",
                    }}
                  >
                    {AVAILABILITY[state].label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
