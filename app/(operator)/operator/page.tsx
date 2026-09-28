import Link from "next/link";
import { DarkTh, KpiCell, OperatorHeader } from "@/components/operator-ui";
import { requireStaff } from "@/lib/auth/context";
import { DEMO_MODE } from "@/lib/auth/mode";
import { listBusinesses } from "@/lib/queries/operator";

/**
 * Every business on Corva.
 *
 * The three questions staff actually ask of this list: can it take a call
 * (does it have an AI and a number), is anyone calling, and are those calls
 * turning into leads. Each row ends in the two things you do next — ring it,
 * or open its console.
 */
export default async function BusinessesPage() {
  await requireStaff();
  const businesses = await listBusinesses();

  const answering = businesses.filter((b) => b.canAnswer).length;
  const conversations = businesses.reduce((n, b) => n + b.conversations7d, 0);
  const leads = businesses.reduce((n, b) => n + b.leads7d, 0);
  const live = businesses.reduce((n, b) => n + b.live, 0);

  const link = { color: "var(--color-accent-400)", fontWeight: 700, fontSize: 11.5 } as const;

  return (
    <section>
      <OperatorHeader
        kicker={`${businesses.length} businesses · ${answering} answering calls`}
        title="Businesses"
        lede="Every business on Corva, whether its AI can take a call, and whether calls are turning into leads."
      >
        <Link
          href="/operator/onboarding"
          className="hov-accent-dark"
          style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "10px 14px" }}
        >
          + Add a business
        </Link>
      </OperatorHeader>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "2px solid var(--color-neutral-700)" }}>
        <KpiCell label="Answering calls" value={`${answering} of ${businesses.length}`} note="an AI and a number" />
        <KpiCell label="Live right now" value={String(live)} note="calls and chats in progress" />
        <KpiCell label="Conversations · 7 days" value={String(conversations)} note="including test calls" />
        <KpiCell label="Leads · 7 days" value={String(leads)} note="mostly captured by the AI" last />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--color-neutral-700)" }}>
            <DarkTh padding="10px 24px">Business</DarkTh>
            <DarkTh width={170}>Number</DarkTh>
            <DarkTh width={190}>AI assistant</DarkTh>
            <DarkTh width={80}>Team</DarkTh>
            <DarkTh width={170}>Last 7 days</DarkTh>
            <DarkTh width={220} padding="10px 24px 10px 10px">
              {" "}
            </DarkTh>
          </tr>
        </thead>
        <tbody>
          {businesses.map((b) => (
            <tr key={`${b.orgSlug}-${b.brandId}`} className="hov-dark" style={{ borderBottom: "1px solid var(--color-neutral-800)", verticalAlign: "top" }}>
              <td style={{ padding: "12px 24px" }}>
                <Link href={`/operator/companies/${b.orgSlug}`} style={{ color: "var(--color-bg)" }}>
                  <b style={{ fontSize: 13 }}>{b.orgName}</b>
                </Link>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                  {b.brandName && b.brandName !== b.orgName ? `${b.brandName} · ` : ""}
                  {b.industry} · added {b.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </td>
              <td style={{ padding: "12px 10px" }}>
                {b.phone ? (
                  <b style={{ color: "var(--color-bg)" }}>{b.phone}</b>
                ) : (
                  <span style={{ color: "var(--color-accent-400)" }}>No number</span>
                )}
              </td>
              <td style={{ padding: "12px 10px" }}>
                {b.agentName ? (
                  <>
                    <b style={{ color: "var(--color-bg)" }}>{b.agentName}</b>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                      {b.model} · {b.docs} doc{b.docs === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "var(--color-accent-400)" }}>Not set up</span>
                )}
              </td>
              <td style={{ padding: "12px 10px", color: "var(--color-neutral-300)" }}>{b.people}</td>
              <td style={{ padding: "12px 10px", color: "var(--color-neutral-300)" }}>
                {b.conversations7d} conversation{b.conversations7d === 1 ? "" : "s"}
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                  {b.leads7d} lead{b.leads7d === 1 ? "" : "s"} · {b.openFollowUps} follow-up{b.openFollowUps === 1 ? "" : "s"} open
                  {b.live > 0 && <b style={{ color: "var(--color-accent-400)" }}> · {b.live} live</b>}
                </span>
              </td>
              <td style={{ padding: "12px 24px 12px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                {b.canAnswer && b.phone && (
                  <Link href={`/operator/testing?dial=${encodeURIComponent(b.phone)}`} style={link}>
                    Call
                  </Link>
                )}
                {DEMO_MODE && b.brandId && (
                  <>
                    <span style={{ color: "var(--color-neutral-700)" }}> · </span>
                    <Link href={`/operator/open?brand=${b.brandId}&next=/app`} style={link}>
                      Open console
                    </Link>
                  </>
                )}
                <span style={{ color: "var(--color-neutral-700)" }}> · </span>
                <Link href={`/operator/companies/${b.orgSlug}`} style={{ ...link, color: "var(--color-neutral-300)" }}>
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
