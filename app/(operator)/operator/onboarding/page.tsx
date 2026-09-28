import Link from "next/link";
import { DarkKicker, DarkTh, OperatorHeader } from "@/components/operator-ui";
import { OnboardCompany } from "@/components/OnboardCompany";
import { requireStaff } from "@/lib/auth/context";
import { onboardCompany, recentlyOnboarded } from "@/lib/actions/onboarding";
import { modelOptions } from "@/lib/queries/models";

/**
 * Onboarding.
 *
 * The start of the chain the whole role model rests on: Corva staff create a
 * company and its first Owner, that Owner invites their managers, and managers
 * invite their agents. Nobody can grant a role above their own at any step, so
 * the chain cannot be walked upwards.
 *
 * The table underneath is the reason this is a screen rather than a button. A
 * workspace created and then abandoned looks identical to a healthy one on the
 * fleet table — same row, same plan, no traffic — and the four steps between
 * "created" and "answering calls" are where onboarding actually fails.
 */
export default async function OnboardingPage() {
  await requireStaff();
  const [recent, models] = await Promise.all([recentlyOnboarded(), modelOptions()]);

  return (
    <section>
      <OperatorHeader
        kicker="Create a company and its first Owner"
        title="Onboarding"
        lede="Corva creates the workspace and one Owner. Everyone else in it is invited by that Owner, or by the managers they appoint — we never add people to a tenant's team."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ borderRight: "2px solid var(--color-neutral-700)", padding: "20px 24px" }}>
          <OnboardCompany onOnboard={onboardCompany} models={models} />
        </div>

        <div style={{ padding: "20px 24px" }}>
          <DarkKicker>Recently created · how far they got</DarkKicker>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-neutral-700)" }}>
                <DarkTh padding="9px 0">Company</DarkTh>
                <DarkTh width={90}>Plan</DarkTh>
                <DarkTh width={150} padding="9px 0">Setup</DarkTh>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.slug} className="hov-dark" style={{ borderBottom: "1px solid var(--color-neutral-800)" }}>
                  <td style={{ padding: "11px 0", verticalAlign: "top" }}>
                    <Link href={`/operator/companies/${r.slug}`} style={{ color: "var(--color-bg)" }}>
                      <b>{r.name}</b>
                    </Link>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                      {r.region} · {r.brands} brand{r.brands === 1 ? "" : "s"} · {r.people} person
                      {r.people === 1 ? "" : "s"}
                      {r.pending > 0 && `, ${r.pending} not yet accepted`}
                    </span>
                  </td>
                  <td style={{ padding: "11px 10px", verticalAlign: "top", color: "var(--color-neutral-300)" }}>
                    {r.plan}
                  </td>
                  <td style={{ padding: "11px 0", verticalAlign: "top" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "flex", gap: 2 }}>
                        {r.steps.map((step) => (
                          <span
                            key={step.label}
                            title={step.label}
                            style={{
                              width: 22,
                              height: 6,
                              display: "block",
                              background: step.done ? "var(--color-accent)" : "var(--color-neutral-700)",
                            }}
                          />
                        ))}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color:
                            r.complete === 4 ? "var(--color-neutral-400)" : "var(--color-accent-400)",
                        }}
                      >
                        {r.complete}/4
                      </span>
                    </div>
                    {r.complete < 4 && (
                      <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "var(--color-neutral-500)" }}>
                        next: {r.steps.find((x) => !x.done)!.label.toLowerCase()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--color-neutral-500)", lineHeight: 1.55 }}>
            The four steps are: the Owner accepts, a document is published, a brand goes live, and
            a second person is invited. A workspace stuck at 1/4 is a failed onboarding, not a
            quiet customer — and it looks identical to a healthy one on the fleet table.
          </p>
        </div>
      </div>
    </section>
  );
}
