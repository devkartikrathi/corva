import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { listPayments } from "@/lib/admin/data";
import { rupees } from "@/lib/billing/plans";

/** Every payment Razorpay has reported, newest first. */
export default async function AdminPaymentsPage() {
  await requireAdmin();
  const rows = await listPayments();
  const received = rows.filter((r) => r.p.status === "verified" || r.p.status === "captured").reduce((n, r) => n + r.p.amountPaise, 0);
  return (
    <section>
      <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em" }}>Payments</h1>
      <p style={{ margin: "8px 0 20px", color: "var(--color-neutral-800)" }}>
        {rupees(received / 100)} received across {rows.length} payment{rows.length === 1 ? "" : "s"}, GST included.
      </p>
      {rows.length === 0 && <p style={{ color: "var(--color-neutral-700)" }}>None yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(({ p, org, slug }) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px 110px 100px 1fr", gap: 10, paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-300)" }}>
            <span>{p.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
            {slug ? (
              <Link href={`/admin/businesses/${slug}`} style={{ fontWeight: 700, color: "var(--color-text)" }}>
                {org}
              </Link>
            ) : (
              <span style={{ color: "var(--color-neutral-700)" }}>(business removed)</span>
            )}
            <span>{p.tier ?? "—"}</span>
            <b>{rupees(p.amountPaise / 100)}</b>
            <span style={{ color: p.status === "verified" || p.status === "captured" ? undefined : "var(--color-accent-700)" }}>
              {p.status}
              {p.granted ? "" : " · not applied"}
            </span>
            <code style={{ fontSize: 11.5 }}>{p.razorpayPaymentId}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
