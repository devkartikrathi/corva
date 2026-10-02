import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";

export const metadata = { title: "Corva admin" };

/**
 * Corva's own back office: every business, its plan and usage, demo requests
 * and payments. Reached only by the emails in CORVA_ADMIN_EMAILS — the gate is
 * here, and again in every page and action under it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="cv-admin" style={{ minHeight: "100vh", background: "var(--color-bg)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
      <header style={{ borderBottom: "2px solid var(--color-divider)", background: "var(--color-text)", color: "var(--color-bg)" }}>
        <div className="cv-admin-bar" style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 26 }}>
          <Link href="/admin" style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em", color: "var(--color-bg)" }}>
            CORVA <span style={{ fontWeight: 600, fontSize: 11, letterSpacing: "0.12em", opacity: 0.7 }}>ADMIN</span>
          </Link>
          {[
            ["/admin", "Businesses"],
            ["/admin/demo-requests", "Demo requests"],
            ["/admin/payments", "Payments"],
            ["/admin/new", "Add a business"],
          ].map(([href, label]) => (
            <Link key={href} href={href} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bg)" }}>
              {label}
            </Link>
          ))}
          <span className="m-hide" style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>{admin.email}</span>
          <Link href="/app" className="cv-admin-main" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-bg)" }}>
            My console →
          </Link>
        </div>
      </header>
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "24px" }}>{children}</main>
    </div>
  );
}
