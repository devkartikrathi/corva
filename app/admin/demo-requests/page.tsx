import { StatusSelect } from "@/components/AdminControls";
import { setDemoStatus } from "@/lib/actions/admin";
import { requireAdmin } from "@/lib/admin/auth";
import { listDemoRequests } from "@/lib/admin/data";

/** Everyone who asked for a demo on the public site, newest first. Each was also emailed to the admins. */
export default async function AdminDemoRequestsPage() {
  await requireAdmin();
  const requests = await listDemoRequests();
  return (
    <section>
      <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em" }}>Demo requests</h1>
      <p style={{ margin: "8px 0 20px", color: "var(--color-neutral-800)" }}>
        {requests.filter((r) => r.status === "new").length} new of {requests.length}.
      </p>
      {requests.length === 0 && <p style={{ color: "var(--color-neutral-700)" }}>None yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {requests.map((r) => (
          <div key={r.id} style={{ border: "1px solid var(--color-neutral-400)", padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
            <div>
              <b style={{ fontSize: 14 }}>{r.name}</b>
              {r.business ? ` · ${r.business}` : ""}
              {r.industry ? <span style={{ color: "var(--color-neutral-700)" }}> · {r.industry}</span> : null}
              <div style={{ marginTop: 4 }}>
                <a href={`mailto:${r.email}`} style={{ color: "var(--color-accent-700)", fontWeight: 600 }}>
                  {r.email}
                </a>
                {r.phone ? ` · ${r.phone}` : ""}
                {r.website ? ` · ${r.website}` : ""}
              </div>
              {r.message && <p style={{ margin: "8px 0 0", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.message}</p>}
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                {r.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ·{" "}
                {r.emailed ? "emailed to you" : "not emailed — email is not set up"}
              </div>
            </div>
            <StatusSelect id={r.id} value={r.status} options={["new", "contacted", "closed"]} onChange={setDemoStatus} />
          </div>
        ))}
      </div>
    </section>
  );
}
