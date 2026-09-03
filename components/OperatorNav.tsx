"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/operator", label: "Fleet" },
  { href: "/operator/companies/aurelius-group", label: "Company detail" },
  { href: "/operator/quality", label: "AI quality" },
  { href: "/operator/revenue", label: "Revenue & plans" },
  { href: "/operator/reliability", label: "Reliability" },
];

export function OperatorNav() {
  const pathname = usePathname();

  return (
    <div
      style={{
        padding: "0 24px",
        display: "flex",
        borderTop: "1px solid var(--color-neutral-800)",
      }}
    >
      {TABS.map((t) => {
        // Any company page keeps the "Company detail" tab lit.
        const active = t.href.startsWith("/operator/companies")
          ? pathname.startsWith("/operator/companies")
          : pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className="hov-dark"
            style={{
              padding: "11px 16px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--color-bg)",
              borderBottom: `3px solid ${active ? "var(--color-accent)" : "transparent"}`,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
