import Link from "next/link";
import { notFound } from "next/navigation";
import { DarkKicker, DarkSectionTitle, OperatorHeader } from "@/components/operator-ui";
import { BrandModelControl, NumberControl, RemoveBusiness } from "@/components/OperatorForms";
import { requireStaff } from "@/lib/auth/context";
import { DEMO_MODE } from "@/lib/auth/mode";
import { removeBusiness, setBrandModel, setBusinessNumber } from "@/lib/actions/operator";
import { getBusiness } from "@/lib/queries/operator";
import { modelOptions } from "@/lib/queries/models";
import { formatPhone } from "@/lib/business/phone";

/**
 * One business, from Corva's side.
 *
 * What staff need to support it: the number it answers on, which model it
 * runs on, what its AI knows, who is on the team, and what has happened on it
 * lately. Changing the number or the model is here; everything the business
 * decides for itself — persona, limits, documents — is in its own console.
 */
export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaff();
  const { slug } = await params;
  const [business, models] = await Promise.all([getBusiness(slug), modelOptions()]);
  if (!business) notFound();
  const { org, brands, people, recent, staffActivity } = business;

  const block = { padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-800)" } as const;
  const muted = { fontSize: 11.5, color: "var(--color-neutral-500)" } as const;

  return (
    <section>
      <OperatorHeader
        kicker={`${brands[0]?.industryLabel ?? "Business"} · added ${org.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
        title={org.name}
      >
        {brands[0]?.phone && (
          <Link
            href={`/operator/testing?dial=${encodeURIComponent(brands[0].phone)}`}
            className="hov-accent-dark"
            style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "10px 14px" }}
          >
            Call {formatPhone(brands[0].phone)}
          </Link>
        )}
        {DEMO_MODE && brands[0] && (
          <Link
            href={`/operator/open?brand=${brands[0].id}&next=/app`}
            className="hov-invert-dark"
            style={{ fontSize: 12, fontWeight: 700, border: "2px solid var(--color-bg)", padding: "8px 14px", color: "var(--color-bg)" }}
          >
            Open their console
          </Link>
        )}
      </OperatorHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr" }}>
        <div style={{ borderRight: "2px solid var(--color-neutral-700)" }}>
          {brands.map((b) => (
            <div key={b.id} style={block}>
              <DarkSectionTitle>
                {b.name} · {b.agentName ?? "no assistant"}
              </DarkSectionTitle>
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <DarkKicker>Phone number</DarkKicker>
                  <div style={{ marginTop: 8 }}>
                    <NumberControl
                      current={b.phone ? formatPhone(b.phone) : null}
                      onSave={async (number) => {
                        "use server";
                        await setBusinessNumber(org.slug, b.id, number);
                      }}
                    />
                  </div>
                  <p style={{ ...muted, margin: "6px 0 0" }}>Calls to this number reach {b.agentName ?? "this business"}.</p>
                </div>
                <div>
                  <BrandModelControl
                    orgSlug={org.slug}
                    brandId={b.id}
                    brandName={b.name}
                    models={models}
                    current={b.modelId}
                    onChange={setBrandModel}
                  />
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <DarkKicker>What the AI knows</DarkKicker>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
                  {b.docs.length === 0 && <span style={muted}>No documents — it can only offer callbacks.</span>}
                  {b.docs.map((d) => (
                    <span key={d.id}>
                      <b>{d.title}</b>{" "}
                      <span style={muted}>
                        · {d.status}
                        {d.source ? ` · from ${d.source}` : ""}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div style={block}>
            <DarkSectionTitle>Recent conversations</DarkSectionTitle>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9, fontSize: 12.5 }}>
              {recent.length === 0 && <span style={muted}>Nobody has called yet.</span>}
              {recent.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 12 }}>
                  <span style={{ width: 110, ...muted }}>
                    {c.startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span style={{ flex: 1 }}>
                    <b>{c.customer}</b> <span style={muted}>· {c.channel.replace("_", " ")} · {c.status.replace("_", " ")}{c.isTest ? " · test" : ""}</span>
                    {c.summary && <span style={{ display: "block", ...muted, color: "var(--color-neutral-300)" }}>{c.summary}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div style={block}>
            <DarkSectionTitle>Team</DarkSectionTitle>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
              {people.map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 10 }}>
                  <b style={{ flex: 1 }}>{p.name}</b>
                  <span style={muted}>{p.role}</span>
                  <span style={{ ...muted, width: 60, textAlign: "right" }}>{p.status === "active" ? p.availability : p.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={block}>
            <DarkSectionTitle>What Corva staff did</DarkSectionTitle>
            <p style={{ ...muted, margin: "6px 0 0" }}>The same rows the business sees in its own audit log.</p>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
              {staffActivity.length === 0 && <span style={muted}>Nothing yet.</span>}
              {staffActivity.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 10 }}>
                  <span style={{ width: 60, ...muted }}>{a.at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  <span style={{ flex: 1 }}>
                    {a.actorName} · {a.action.replace(/[._]/g, " ")}
                    {a.target ? ` · ${a.target}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...block, borderBottom: undefined }}>
            <RemoveBusiness
              name={org.name}
              onRemove={async (confirmName) => {
                "use server";
                await removeBusiness(org.slug, confirmName);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
