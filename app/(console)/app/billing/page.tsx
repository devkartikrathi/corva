import { Bar, Kicker, ScreenHeader, ScreenRefusal, SectionTitle } from "@/components/ui";
import { PlanCheckout } from "@/components/PlanCheckout";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { paymentsFor } from "@/lib/billing/payments";
import { BUYABLE, GRACE_DAYS, GST_RATE, PLANS, amount, rupees } from "@/lib/billing/plans";
import { razorpayConfig } from "@/lib/billing/razorpay";
import { accountState, quote } from "@/lib/billing/usage";

/**
 * Billing: what the business is on, what it has used, and how to pay.
 *
 * Usage is counted from the conversations themselves, for the current period.
 * Buying or renewing a plan starts a fresh period; anything used beyond the
 * old period's allowance is added to that payment.
 */

const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Meter({ label, used, included }: { label: string; used: number; included: number }) {
  const finite = Number.isFinite(included);
  const share = finite && included > 0 ? Math.min(1, used / included) : 0;
  const over = finite && used > included;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <Kicker>{label}</Kicker>
        <span style={{ fontSize: 12.5 }}>
          <b style={{ fontSize: 20, fontWeight: 800, color: over ? "var(--color-accent-700)" : undefined }}>{used.toLocaleString("en-IN")}</b>
          <span style={{ color: "var(--color-neutral-700)" }}> of {amount(included)}</span>
        </span>
      </div>
      <Bar width={`${Math.round(share * 100)}%`} color={over || share >= 0.9 ? "var(--color-accent)" : "var(--color-text)"} style={{ marginTop: 8 }} />
    </div>
  );
}

export default async function BillingPage() {
  const { session, denied } = await guardScreen("billing.manage");
  if (denied) {
    return <ScreenRefusal title="Billing" reason={refusalReason(denied)} next="An Owner or Admin can see the plan and pay for it." />;
  }

  const [state, receipts] = await Promise.all([accountState(session.orgId), paymentsFor(session.orgId)]);
  const { plan } = state;
  const payable = razorpayConfig().ok;

  const statusLine =
    state.status === "lapsed"
      ? `${plan.id === "pilot" ? "The pilot" : "This plan"} ended on ${date(state.periodEnd)}. The assistant has stopped taking new conversations.`
      : state.status === "grace"
        ? `${plan.id === "pilot" ? "The pilot" : "This plan"} ended on ${date(state.periodEnd)}. The assistant keeps answering for ${GRACE_DAYS} days after that.`
        : plan.id === "pilot"
          ? `Your pilot runs until ${date(state.periodEnd)} — ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left.`
          : `Paid until ${date(state.periodEnd)} — ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left.`;

  return (
    <section>
      <ScreenHeader kicker={`Workspace · ${session.orgName}`} title="Billing" lede={statusLine} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* This period */}
        <div style={{ padding: "20px 24px", borderRight: "2px solid var(--color-divider)", borderBottom: "2px solid var(--color-divider)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <SectionTitle size={16}>{plan.name}</SectionTitle>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "3px 7px",
                background: state.status === "active" ? "var(--color-neutral-200)" : "var(--color-accent)",
                color: state.status === "active" ? "var(--color-neutral-800)" : "var(--color-bg)",
              }}
            >
              {state.status === "active" ? "Active" : state.status === "grace" ? "Ended — in grace" : "Ended"}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-neutral-700)" }}>
            This period: {date(state.periodStart)} – {date(state.periodEnd)}. Conversations you run yourself from Try it are not counted.
          </p>

          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
            <Meter label="AI chats" used={state.usage.chats} included={plan.chats} />
            <Meter label="AI voice minutes" used={state.usage.voiceMinutes} included={plan.voiceMinutes} />
          </div>

          {plan.overage ? (
            <p style={{ margin: "16px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
              {state.over.rupees > 0 ? (
                <>
                  <b style={{ color: "var(--color-accent-700)" }}>{rupees(state.over.rupees)} over</b> so far —{" "}
                  {state.over.chats > 0 && `${state.over.chats} chats at ${rupees(plan.overage.chat)}`}
                  {state.over.chats > 0 && state.over.voiceMinutes > 0 && ", "}
                  {state.over.voiceMinutes > 0 && `${state.over.voiceMinutes} voice minutes at ${rupees(plan.overage.voiceMinute)}`}. It is added to
                  your next payment; the assistant keeps answering.
                </>
              ) : (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Beyond what is included: {rupees(plan.overage.chat)} a chat and {rupees(plan.overage.voiceMinute)} a voice minute, added to your
                  next payment. The assistant never stops mid-month.
                </span>
              )}
            </p>
          ) : Number.isFinite(plan.chats) ? (
            <p style={{ margin: "16px 0 0", fontSize: 12.5, lineHeight: 1.5, color: state.exhausted.chats || state.exhausted.voice ? "var(--color-accent-700)" : "var(--color-neutral-700)" }}>
              {state.exhausted.chats || state.exhausted.voice
                ? `The pilot's ${state.exhausted.chats ? "chats" : "voice minutes"} are used up, so the assistant has stopped taking new ${state.exhausted.chats ? "chats" : "calls"}. Choose a plan to carry on.`
                : "When the pilot's allowance is used, the assistant stops taking new conversations until you choose a plan."}
            </p>
          ) : null}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--color-neutral-300)", display: "flex", gap: 28, fontSize: 12.5 }}>
            <span>
              Brands <b>{state.counts.brands}</b> of {amount(plan.brands)}
            </span>
            <span>
              Team members <b>{state.counts.members}</b> of {amount(plan.members)}
            </span>
            <span>
              History kept <b>{plan.historyDays >= 3650 ? "as agreed" : plan.historyDays >= 365 ? `${Math.round(plan.historyDays / 365)} years` : `${plan.historyDays} days`}</b>
            </span>
          </div>
        </div>

        {/* Receipts */}
        <div style={{ padding: "20px 24px", borderBottom: "2px solid var(--color-divider)" }}>
          <SectionTitle size={16}>Payments</SectionTitle>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
            {receipts.length === 0 && <span style={{ color: "var(--color-neutral-700)" }}>No payments yet.</span>}
            {receipts.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr auto", gap: 12, paddingBottom: 8, borderBottom: "1px solid var(--color-neutral-300)" }}>
                <span style={{ color: "var(--color-neutral-700)" }}>{date(p.createdAt)}</span>
                <span>
                  <b>{p.tier ? PLANS[p.tier as keyof typeof PLANS]?.name ?? p.tier : "Payment"}</b>
                  <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                    Plan {rupees(p.planPaise / 100)}
                    {p.overagePaise > 0 ? ` · overage ${rupees(p.overagePaise / 100)}` : ""} · GST {rupees(p.gstPaise / 100)} ·{" "}
                    <code style={{ fontSize: 10.5 }}>{p.razorpayPaymentId}</code>
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <b>{rupees(p.amountPaise / 100)}</b>
                  <span style={{ display: "block", fontSize: 11, color: p.status === "failed" || p.status === "refunded" || p.status === "disputed" ? "var(--color-accent-700)" : "var(--color-neutral-700)" }}>
                    {p.status === "verified" || p.status === "captured" ? "Paid" : p.status[0].toUpperCase() + p.status.slice(1)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Plans */}
      <div style={{ padding: "20px 24px" }}>
        <SectionTitle size={16}>{plan.id === "pilot" ? "Choose a plan" : "Renew or change plan"}</SectionTitle>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-neutral-700)", maxWidth: "78ch", lineHeight: 1.5 }}>
          Paying starts a fresh month from today{state.over.rupees > 0 ? `, and settles the ${rupees(state.over.rupees)} of overage on this one` : ""}. Prices
          are before {Math.round(GST_RATE * 100)}% GST. There is no automatic charge: you pay for each month here.
        </p>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {BUYABLE.map((id) => {
            const p = PLANS[id];
            const price = quote(p, state);
            const current = plan.id === id;
            return (
              <div key={id} style={{ border: current ? "2px solid var(--color-accent)" : "2px solid var(--color-text)", padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 16 }}>{p.name}</b>
                  {current && <Kicker>Your plan</Kicker>}
                </div>
                <div style={{ marginTop: 8, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em" }}>
                  {rupees(p.priceRupees!)}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-neutral-700)" }}> / month</span>
                </div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>
                  <li>
                    {amount(p.chats)} AI chats + {amount(p.voiceMinutes)} voice minutes
                  </li>
                  <li>
                    {p.brands === 1 ? "One brand" : `Up to ${p.brands} brands`} · {p.members} team members
                  </li>
                  <li>{p.management ? "Team performance and the audit log" : "Leads, follow-ups, API and webhooks"}</li>
                </ul>
                {price && (
                  <p style={{ margin: "12px 0 10px", fontSize: 12, color: "var(--color-neutral-700)" }}>
                    Today: <b style={{ color: "var(--color-text)" }}>{rupees(price.totalRupees)}</b> — plan {rupees(price.planRupees)}
                    {price.overageRupees > 0 ? ` + overage ${rupees(price.overageRupees)}` : ""} + GST {rupees(price.gstRupees)}
                  </p>
                )}
                {payable ? (
                  <PlanCheckout tier={id} label={current ? `Renew ${p.name}` : `Choose ${p.name}`} featured={id === "growth"} />
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: "var(--color-neutral-700)" }}>
                    Online payment is not switched on yet — <a href="/demo" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>ask Corva</a> to set this plan up.
                  </p>
                )}
              </div>
            );
          })}
          <div style={{ border: "2px solid var(--color-neutral-400)", padding: "16px 18px" }}>
            <b style={{ fontSize: 16 }}>Business</b>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em" }}>Talk to us</div>
            <ul style={{ margin: "10px 0 14px", paddingLeft: 16, fontSize: 12.5, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>
              <li>Usage and team sized to you</li>
              <li>Many brands or branches</li>
              <li>Custom industry setup and an SLA</li>
            </ul>
            <a href="/demo" className="hov-invert" style={{ display: "block", textAlign: "center", fontSize: 13, fontWeight: 700, padding: "10px 16px", border: "2px solid var(--color-text)", color: "var(--color-text)" }}>
              Contact us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
