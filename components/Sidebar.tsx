"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { NavItem } from "@/lib/nav";

export type BrandOption = { id: string; name: string; initials: string; isLive: boolean };

export function Sidebar({
  brand,
  brands,
  orgName,
  userName,
  userRole,
  counts,
  groups,
  onSwitchBrand,
}: {
  brand: BrandOption;
  brands: BrandOption[];
  orgName: string;
  userName: string;
  userRole: string;
  counts: { live: number; waiting: number };
  /** Already filtered to what this role may reach — see lib/nav.ts. */
  groups: { label: string; items: NavItem[] }[];
  onSwitchBrand: (brandId: string) => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [switching, startSwitch] = useTransition();

  return (
    <aside
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

      <div
        style={{
          borderTop: "2px solid var(--color-divider)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
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
          }}
        >
          {userName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>{userName}</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
            {userRole}
          </span>
        </span>
      </div>
    </aside>
  );
}
