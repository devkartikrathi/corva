import Link from "next/link";
import { DarkKicker, DarkTh, OperatorHeader } from "@/components/operator-ui";
import { OnboardCompany } from "@/components/OnboardCompany";
import { requireStaff } from "@/lib/auth/context";
import { DEMO_MODE } from "@/lib/auth/mode";
import { enterBusiness, onboardBusiness, recentlyOnboarded } from "@/lib/actions/onboarding";
import { INDUSTRIES } from "@/lib/business/industries";

/**
 * Adding a business.
 *
 * The form on the left produces something that can be rung; the table on the
 * right is the recent ones, each with its number, so the obvious next step —
 * call it — is one click from wherever you are.
 */
export default async function OnboardingPage() {
  await requireStaff();
  const recent = await recentlyOnboarded();

  return (
    <section>
      <OperatorHeader
        kicker="New business"
        title="Add a business"
        lede="Tell Corva what the business is and where its website lives. It sets up an AI assistant that knows the business, gives it a phone number, and it can take calls straight away."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr" }}>
        <div style={{ borderRight: "2px solid var(--color-neutral-700)", padding: "20px 24px" }}>
          <OnboardCompany
            onOnboard={onboardBusiness}
            onEnter={enterBusiness}
            industries={INDUSTRIES.map((i) => ({ key: i.key, label: i.label }))}
            demo={DEMO_MODE}
          />
        </div>

        <div style={{ padding: "20px 24px" }}>
          <DarkKicker>Recently added</DarkKicker>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-neutral-700)" }}>
                <DarkTh padding="9px 0">Business</DarkTh>
                <DarkTh width={150}>Number</DarkTh>
                <DarkTh width={60} padding="9px 0">Status</DarkTh>
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
                      {r.industry} · {r.people} {r.people === 1 ? "person" : "people"}
                    </span>
                  </td>
                  <td style={{ padding: "11px 10px", verticalAlign: "top" }}>
                    {r.phone ? (
                      <Link
                        href={`/operator/testing?dial=${encodeURIComponent(r.phone)}`}
                        style={{ color: "var(--color-accent-400)", fontWeight: 700 }}
                      >
                        {r.phone}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--color-neutral-500)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "11px 0", verticalAlign: "top", fontSize: 11, fontWeight: 700 }}>
                    <span style={{ color: r.live ? "var(--color-accent-400)" : "var(--color-neutral-500)" }}>
                      {r.live ? "Live" : "Not live"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
