import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { listAccounts } from "@/lib/admin/data";
import { amount, rupees } from "@/lib/billing/plans";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—");
const th = { textAlign: "left", padding: "8px 10px 8px 0", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-700)" } as const;
const td = { padding: "10px 10px 10px 0", verticalAlign: "top" } as const;

/** Every business on Corva: what it is on, how much it has used, whether anything is happening. */
export default async function AdminBusinessesPage() {
  await requireAdmin();
  const accounts = await listAccounts();
  const paying = accounts.filter((a) => a.account.plan.id !== "pilot" && a.account.status !== "lapsed").length;
  const lapsing = accounts.filter((a) => a.account.status !== "active" || a.account.daysLeft <= 3).length;

  return (
    <section>
      <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em" }}>Businesses</h1>
      <p style={{ margin: "8px 0 0", color: "var(--color-neutral-800)" }}>
        {accounts.length} in all · {paying} on a paid plan · {lapsing} ending or ended.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
            <th style={th}>Business</th>
            <th style={th}>Owner</th>
            <th style={th}>Plan</th>
            <th style={th}>Ends</th>
            <th style={th}>Chats</th>
            <th style={th}>Voice min</th>
            <th style={th}>Leads</th>
            <th style={th}>Last conversation</th>
            <th style={th}>Paid</th>
          </tr>
        </thead>
        <tbody>
          {accounts.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...td, color: "var(--color-neutral-700)" }}>
                No businesses yet.
              </td>
            </tr>
          )}
          {accounts.map((a) => {
            const { account } = a;
            const alert = account.status !== "active" || account.exhausted.chats || account.exhausted.voice;
            return (
              <tr key={a.id} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                <td style={td}>
                  <Link href={`/admin/businesses/${a.slug}`} style={{ fontWeight: 700, color: "var(--color-text)" }}>
                    {a.name}
                  </Link>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                    {a.industry} · since {day(a.createdAt)}
                  </span>
                </td>
                <td style={td}>
                  {a.ownerName ?? "—"}
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>{a.owner}</span>
                </td>
                <td style={td}>
                  <b>{account.plan.name}</b>
                  {alert && (
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--color-accent-700)" }}>
                      {account.status === "lapsed" ? "stopped" : account.status === "grace" ? "in grace" : "allowance used"}
                    </span>
                  )}
                </td>
                <td style={{ ...td, color: account.daysLeft <= 3 ? "var(--color-accent-700)" : undefined }}>
                  {day(account.periodEnd)}
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                    {account.daysLeft >= 0 ? `${account.daysLeft}d left` : `${-account.daysLeft}d ago`}
                  </span>
                </td>
                <td style={td}>
                  {account.usage.chats} <span style={{ color: "var(--color-neutral-700)" }}>/ {amount(account.plan.chats)}</span>
                </td>
                <td style={td}>
                  {account.usage.voiceMinutes} <span style={{ color: "var(--color-neutral-700)" }}>/ {amount(account.plan.voiceMinutes)}</span>
                </td>
                <td style={td}>{a.leads}</td>
                <td style={td}>{day(a.lastConversation)}</td>
                <td style={td}>{a.paidRupees ? rupees(a.paidRupees) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
