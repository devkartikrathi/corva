import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * The first things to do with a new business, ticked off as they happen.
 *
 * Shown on Home until every step is done. Each step is read from what exists
 * — a test conversation, a key, a second team member — rather than from a
 * flag someone has to remember to set.
 */
export async function GettingStarted({ orgId, brandId, agentName }: { orgId: string; brandId: string; agentName: string }) {
  const [row] = await db
    .select({
      tried: sql<boolean>`exists (select 1 from ${s.conversations} c where c.brand_id = ${brandId})`,
      documents: sql<number>`(select count(*)::int from ${s.documents} d where d.brand_id = ${brandId} and d.status = 'published')`,
      catalog: sql<boolean>`exists (select 1 from ${s.catalogItems} i where i.brand_id = ${brandId})`,
      team: sql<number>`(select count(*)::int from ${s.memberships} m where m.org_id = ${orgId} and m.status in ('active', 'invited'))`,
      keys: sql<boolean>`exists (select 1 from ${s.apiKeys} k where k.brand_id = ${brandId} and k.revoked_at is null)`,
      real: sql<boolean>`exists (select 1 from ${s.conversations} c where c.brand_id = ${brandId} and c.is_test = false)`,
      tier: s.organizations.tier,
    })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);
  if (!row) return null;

  const steps = [
    { done: row.tried, title: `Talk to ${agentName}`, body: "Chat or call it as a customer would and see what it says.", href: "/app/try", cta: "Try it" },
    { done: row.documents > 0, title: "Check what it knows", body: "Read what it learned from your website; correct or add to it.", href: "/app/knowledge", cta: "Knowledge" },
    { done: row.catalog, title: "List what you sell", body: "Your products and services, with prices, for it to quote.", href: "/app/catalog", cta: "Products & services" },
    { done: false, optional: true, title: "Choose what it collects", body: "The details it asks every customer for — your list.", href: "/app/details", cta: "Details" },
    { done: row.team > 1, title: "Invite your team", body: "Leads and follow-ups are given to the people here.", href: "/app/team", cta: "People" },
    { done: row.keys, title: "Put it on your website", body: "Make an API key and give it to your developer with the docs.", href: "/app/setup", cta: "API key" },
    { done: row.tier !== "pilot", title: "Choose a plan", body: "Before the pilot ends, so it keeps answering.", href: "/app/billing", cta: "Billing" },
  ];
  const remaining = steps.filter((x) => !x.done && !x.optional).length;
  if (remaining === 0 && row.real) return null;

  return (
    <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)", background: "var(--color-surface)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <b style={{ fontSize: 16 }}>Getting started</b>
        <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
          {remaining === 0 ? "All set — waiting for your first real customer." : `${remaining} to go`}
        </span>
      </div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {steps.map((step) => (
          <Link
            key={step.title}
            href={step.href}
            className="hov-raise"
            style={{
              display: "block",
              padding: "11px 13px",
              border: `1px solid ${step.done ? "var(--color-neutral-300)" : "var(--color-text)"}`,
              background: "var(--color-bg)",
              color: "var(--color-text)",
              opacity: step.done ? 0.6 : 1,
            }}
          >
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontWeight: 800, color: step.done ? "var(--color-neutral-700)" : "var(--color-accent-700)" }}>{step.done ? "✓" : "→"}</span>
              <b style={{ fontSize: 13, textDecoration: step.done ? "line-through" : undefined }}>{step.title}</b>
            </span>
            <span style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.45, color: "var(--color-neutral-800)" }}>{step.body}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
