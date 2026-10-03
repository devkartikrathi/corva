import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { CollectionsForm, PlanForm, RemoveBusiness } from "@/components/AdminControls";
import { recordPayout, removeBusiness, setCollections, setPlan } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatRupees } from "@/lib/money";
import { corvaRazorpay, owedToBusiness } from "@/lib/payments/hosted";
import { requireAdmin } from "@/lib/admin/auth";
import { getAccount } from "@/lib/admin/data";
import { PLANS, amount, rupees } from "@/lib/billing/plans";
import { industryFor } from "@/lib/business/industries";

const date = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const h2 = { margin: "28px 0 10px", fontWeight: 800, fontSize: 16 } as const;

/**
 * One business, from outside: its plan and usage, who is in it, what it has
 * paid. Not its conversations or customers — those are the business's own.
 */
export default async function AdminBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const { slug } = await params;
  const data = await getAccount(slug);
  if (!data) notFound();
  const { org, account, brands, people, payments } = data;
  // Collected by Corva, per brand: its settings (on or off) and what is owed to it.
  const collections = await Promise.all(
    brands.map(async (b) => ({
      brand: b,
      settings: (await db.select().from(s.collectionSettings).where(eq(s.collectionSettings.brandId, b.id)).limit(1))[0] ?? null,
      owed: await owedToBusiness(b.id),
    })),
  );
  const corvaKeys = corvaRazorpay();

  return (
    <section style={{ maxWidth: 900 }}>
      <Link href="/admin" style={{ fontSize: 12.5, color: "var(--color-neutral-700)" }}>
        ← Businesses
      </Link>
      <h1 style={{ margin: "8px 0 0", fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em" }}>{org.name}</h1>
      <p style={{ margin: "6px 0 0", color: "var(--color-neutral-800)" }}>
        {brands.map((b) => `${b.name} (${industryFor(b.industry).label}${b.agentName ? `, assistant “${b.agentName}”` : ""})`).join(" · ")} · created {date(org.createdAt)}
      </p>

      <h2 style={h2}>Plan</h2>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        <b>{account.plan.name}</b> — {date(account.periodStart)} to {date(account.periodEnd)} ·{" "}
        <b style={{ color: account.status === "active" ? undefined : "var(--color-accent-700)" }}>
          {account.status === "active" ? `${account.daysLeft} days left` : account.status === "grace" ? "ended, in grace" : "ended — assistant stopped"}
        </b>
        <br />
        Chats {account.usage.chats} of {amount(account.plan.chats)} · voice minutes {account.usage.voiceMinutes} of {amount(account.plan.voiceMinutes)}
        {account.over.rupees > 0 ? ` · overage owed ${rupees(account.over.rupees)}` : ""} · brands {account.counts.brands} of {amount(account.plan.brands)} · team{" "}
        {account.counts.members} of {amount(account.plan.members)}
      </p>
      <div style={{ marginTop: 12 }}>
        <PlanForm
          slug={org.slug}
          current={account.plan.id}
          plans={Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, days: p.periodDays }))}
          onSet={setPlan}
        />
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-neutral-700)" }}>
          For a longer pilot, a plan paid by bank transfer, or Business. Changing the plan starts a fresh period; keeping it only moves the end date.
        </p>
      </div>

      <h2 style={h2}>Payments collected by Corva</h2>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
        For a business with no payment system of its own: the team and the assistant can still send customers a payment
        link, made on Corva&rsquo;s Razorpay account. The money lands with Corva and is owed to the business, less the fee,
        until it is paid out. A business with its own payment endpoint uses that instead.{" "}
        {!corvaKeys ? <b style={{ color: "var(--color-accent-700)" }}>Corva&rsquo;s Razorpay keys are not set, so no link can be made yet.</b> : corvaKeys.test ? <b>Corva&rsquo;s Razorpay is in test mode.</b> : null}
      </p>
      {collections.map(({ brand, settings, owed }) => (
        <div key={brand.id} style={{ marginBottom: 12 }}>
          {collections.length > 1 && <div style={{ fontWeight: 700, marginBottom: 4 }}>{brand.name}</div>}
          <CollectionsForm
            brandId={brand.id}
            current={{
              enabled: settings?.enabled ?? false,
              feePercent: settings ? String(settings.feeBasisPoints / 100) : "0",
              payoutNote: settings?.payoutNote ?? "",
              routeAccountId: settings?.routeAccountId ?? "",
            }}
            owed={{ owedLabel: formatRupees(owed.owedPaise, { decimals: "auto" }), payments: owed.payments }}
            onSave={setCollections}
            onPayout={recordPayout}
          />
        </div>
      ))}

      <h2 style={h2}>People</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {people.map((p) => (
          <div key={p.email} className="m-stack m-gap-s m-border-b" style={{ display: "grid", gridTemplateColumns: "200px 1fr 90px 90px 130px", gap: 10 }}>
            <b>{p.name}</b>
            <span>{p.email}</span>
            <span>{p.role}</span>
            <span style={{ color: p.status === "active" ? undefined : "var(--color-neutral-700)" }}>{p.status}</span>
            <span style={{ color: "var(--color-neutral-700)" }}>{p.lastActiveAt ? `seen ${date(p.lastActiveAt)}` : "not signed in yet"}</span>
          </div>
        ))}
      </div>

      <h2 style={h2}>Payments</h2>
      {payments.length === 0 ? (
        <p style={{ margin: 0, color: "var(--color-neutral-700)" }}>None.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {payments.map((p) => (
            <div key={p.id} className="m-cols-2 m-gap-s" style={{ display: "grid", gridTemplateColumns: "110px 100px 110px 1fr", gap: 10 }}>
              <span>{date(p.createdAt)}</span>
              <b>{rupees(p.amountPaise / 100)}</b>
              <span>{p.status}</span>
              <code style={{ fontSize: 11.5 }}>{p.razorpayPaymentId}</code>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ ...h2, color: "var(--color-accent-700)" }}>Remove</h2>
      <p style={{ margin: "0 0 10px", color: "var(--color-neutral-800)" }}>
        Deletes the business and everything in it — conversations, customers, leads, people. It cannot be undone.
      </p>
      <RemoveBusiness slug={org.slug} name={org.name} onRemove={removeBusiness} />
    </section>
  );
}
