import { requireStaff } from "@/lib/auth/context";
import { OperatorNav } from "@/components/OperatorNav";
import { getPlatformPulse } from "@/lib/queries/operator";

export const metadata = {
  title: "Corva · Platform operator",
};

/**
 * The operator console is never prerendered.
 *
 * In demo mode the staff session comes from the database rather than from a
 * cookie, so nothing in this tree touches a request-time API and Next will
 * happily bake it at build time — leaving staff looking at a fleet snapshot
 * from whenever the deployment happened. The whole console is a live view of
 * an unbounded number of tenants, so it is dynamic by declaration.
 */
export const dynamic = "force-dynamic";

/**
 * The platform operator console. Corva staff, not tenants — hence the dark
 * ground, the staff banner, and the reminder that every action is audited.
 */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireStaff();
  const pulse = await getPlatformPulse();

  return (
    <div className="operator-root">
      <header style={{ borderBottom: "2px solid var(--color-neutral-700)" }}>
        <div style={{ padding: "0 24px", height: 54, display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>CORVA</span>
            <span style={{ width: 7, height: 7, background: "var(--color-accent)", display: "block" }} />
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              border: "1px solid var(--color-neutral-600)",
              color: "var(--color-neutral-300)",
              padding: "3px 8px",
            }}
          >
            Platform operator
          </span>
          <span style={{ height: 22, width: 1, background: "var(--color-neutral-800)" }} />
          <span style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>
            Signed in as <b style={{ color: "var(--color-bg)" }}>{staff.email}</b> · Staff · all actions
            audited
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 11.5,
              color: "var(--color-neutral-500)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  background: pulse.openIncidents > 0 ? "var(--color-accent)" : "var(--color-neutral-600)",
                  display: "block",
                  animation: pulse.openIncidents > 0 ? "cv-pulse 1.8s ease-in-out infinite" : undefined,
                }}
              />
              <b style={{ color: "var(--color-bg)" }}>
                {pulse.openIncidents} incident{pulse.openIncidents === 1 ? "" : "s"} open
              </b>
            </span>
            <span>
              Voice p95 <b style={{ color: "var(--color-bg)" }}>{pulse.voiceP95Ms}ms</b>
            </span>
            <span>
              Conversations in flight <b style={{ color: "var(--color-bg)" }}>{pulse.inFlight}</b>
            </span>
          </span>
        </div>
        <OperatorNav />
      </header>
      {children}
    </div>
  );
}
