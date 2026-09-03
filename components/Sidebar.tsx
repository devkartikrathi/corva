"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "@/lib/nav";

export function Sidebar({
  brandName,
  orgName,
  initials,
  userName,
  userRole,
  counts,
}: {
  brandName: string;
  orgName: string;
  initials: string;
  userName: string;
  userRole: string;
  counts: { live: number; waiting: number };
}) {
  const pathname = usePathname();

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

      <button
        type="button"
        className="hov-raise"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-neutral-300)",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 10,
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
          }}
        >
          {initials}
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
            {brandName}
          </span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--color-neutral-700)" }}>
            {orgName}
          </span>
        </span>
        <span style={{ fontSize: 10, color: "var(--color-neutral-700)" }}>▾</span>
      </button>

      <nav style={{ flex: 1, padding: "10px 0 20px" }}>
        {navGroups.map((group, i) => (
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
