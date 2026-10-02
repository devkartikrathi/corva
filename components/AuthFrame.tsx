import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around Clerk's hosted sign-in and sign-up components, so the
 * authentication step looks like the rest of the product rather than a
 * detour out of it.
 */
export function AuthFrame({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <div className="m-stack cv-auth" style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      <div
        className="cv-auth-side" style={{
          borderRight: "2px solid var(--color-divider)",
          padding: "48px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 8, color: "var(--color-text)" }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>CORVA</span>
          <span style={{ width: 8, height: 8, background: "var(--color-accent)", display: "block" }} />
        </Link>

        <div style={{ margin: "auto 0", maxWidth: "34ch" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-neutral-700)",
            }}
          >
            {kicker}
          </div>
          <h1
            style={{
              margin: "12px 0 0",
              fontWeight: 800,
              fontSize: 42,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
            }}
          >
            {title}
          </h1>
          <p
            style={{
              margin: "20px 0 0",
              fontSize: 15,
              lineHeight: 1.55,
              color: "var(--color-neutral-800)",
            }}
          >
            {lede}
          </p>
        </div>

        <div className="m-hide" style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          © 2026 Corva Systems Ltd · London
        </div>
      </div>

      <div
        className="cv-auth-main" style={{
          display: "grid",
          placeItems: "center",
          padding: 48,
          background: "var(--color-surface)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
