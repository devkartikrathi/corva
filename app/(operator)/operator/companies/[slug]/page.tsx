import { notFound } from "next/navigation";
import {
  DarkAccentButton,
  DarkBar,
  DarkKicker,
  DarkOutlineButton,
  DarkSectionTitle,
  DarkStatRow,
} from "@/components/operator-ui";
import { operatorConfig } from "@/lib/config";
import { getTenantDetail } from "@/lib/queries/operator";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getTenantDetail(slug);
  if (!detail) notFound();

  const {
    org,
    brands: tenantBrands,
    usage: tenantUsage,
    conversations,
    flags: featureFlags,
    support,
    billing: tenantBilling,
    notes: accountNotes,
  } = detail;

  const identity = [
    `${tenantBrands.length} brand${tenantBrands.length === 1 ? "" : "s"} · ${org.seatCount} seats`,
    `Customer since ${org.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`,
    `${org.region} residency`,
    org.renewsAt
      ? `Renews ${org.renewsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
      : null,
  ].filter(Boolean) as string[];

  const supportAccess = [
    {
      label: "Current grant",
      value: support.current
        ? `expires ${support.current.expiresAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
        : "None",
    },
    {
      label: "Last grant",
      value: support.last
        ? support.last.grantedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "Never",
    },
    { label: "Reason required", value: "Yes" },
  ];

  const initials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <section>
      {/* Identity */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "2px solid var(--color-neutral-700)",
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        <span
          style={{
            width: 50,
            height: 50,
            background: "var(--color-bg)",
            color: "var(--color-text)",
            fontWeight: 800,
            fontSize: 17,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontWeight: 800, fontSize: 27, letterSpacing: "-0.028em", lineHeight: 1 }}>
              {org.name}
            </h1>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: "var(--color-accent)",
                color: "var(--color-bg)",
                padding: "4px 8px",
              }}
            >
              {org.plan} plan
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                border: "1px solid var(--color-neutral-600)",
                padding: "3px 8px",
                color: "var(--color-neutral-300)",
              }}
            >
              Health {org.healthScore ?? "—"}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 18,
              fontSize: 12.5,
              color: "var(--color-neutral-400)",
              flexWrap: "wrap",
            }}
          >
            {identity.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <DarkAccentButton>Request support access</DarkAccentButton>
          <DarkOutlineButton>Open a ticket</DarkOutlineButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 340px" }}>
        {/* Usage & brands */}
        <div style={{ borderRight: "1px solid var(--color-neutral-800)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-800)" }}>
            <DarkSectionTitle style={{ marginBottom: 14 }}>Usage</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 }}>
              <div>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ flex: 1, color: "var(--color-neutral-400)" }}>
                    Conversations recorded
                  </span>
                  <b>{conversations.toLocaleString("en-GB")}</b>
                </div>
                <DarkBar
                  width={`${Math.min(100, conversations)}%`}
                  color="var(--color-accent)"
                  style={{ marginTop: 5 }}
                />
              </div>
              {tenantUsage.map((u) => (
                <DarkStatRow key={u.label} label={u.label} value={u.value} />
              ))}
            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <DarkSectionTitle style={{ marginBottom: 14 }}>Brands</DarkSectionTitle>
            {tenantBrands.map((b) => (
              <div
                key={b.name}
                style={{
                  padding: "11px 0",
                  borderTop: "1px solid var(--color-neutral-800)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 12.5,
                }}
              >
                <b style={{ flex: 1 }}>{b.name}</b>
                <span style={{ color: "var(--color-neutral-500)" }}>{b.conv}</span>
                <span style={{ width: 54, textAlign: "right", color: b.color, fontWeight: 700 }}>
                  {b.containment}
                </span>
                <span
                  style={{
                    width: 66,
                    textAlign: "right",
                    fontSize: 11,
                    color: "var(--color-neutral-500)",
                  }}
                >
                  {b.agent}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Health & flags */}
        <div style={{ borderRight: "2px solid var(--color-neutral-700)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-800)" }}>
            <DarkSectionTitle style={{ marginBottom: 14 }}>AI health</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {tenantBilling.map((h) => (
                <DarkStatRow
                  key={h.label}
                  label={h.label}
                  value={h.value}
                  valueColor={h.hot ? "var(--color-accent-400)" : undefined}
                />
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                padding: "11px 13px",
                background: "var(--color-neutral-900)",
                borderLeft: "3px solid var(--color-accent)",
                fontSize: 12,
                color: "var(--color-neutral-300)",
                lineHeight: 1.45,
              }}
            >
              You are seeing health and configuration only. Transcripts and customer records stay
              inside this workspace unless they grant time-boxed access, which is written to their
              audit log.
            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <DarkSectionTitle style={{ marginBottom: 14 }}>Feature flags</DarkSectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {featureFlags.map((f) => (
                <div
                  key={f.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--color-neutral-800)",
                  }}
                >
                  <span style={{ flex: 1 }}>
                    <b>{f.name}</b>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)" }}>
                      {f.note}
                    </span>
                  </span>
                  <span
                    role="img"
                    aria-label={`${f.name}: ${f.on ? "on" : "off"}`}
                    style={{ width: 34, height: 18, background: f.trackBg, display: "block", position: "relative" }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: f.knob,
                        width: 14,
                        height: 14,
                        background: "var(--color-bg)",
                        display: "block",
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Support access, billing, notes */}
        <div>
          {operatorConfig.showSupportAccessGuard && (
            <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-neutral-700)" }}>
              <DarkKicker>Support access</DarkKicker>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: "var(--color-neutral-300)",
                  lineHeight: 1.5,
                }}
              >
                You cannot read a company&rsquo;s transcripts or customer records by default. Access is
                requested, time-boxed, visible to their Owner, and written to their audit log.
              </div>
              <div
                style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}
              >
                {supportAccess.map((s) => (
                  <DarkStatRow key={s.label} label={s.label} value={s.value} />
                ))}
              </div>
              <button
                type="button"
                className="hov-invert-dark"
                style={{
                  marginTop: 12,
                  width: "100%",
                  fontSize: 11.5,
                  fontWeight: 700,
                  border: "2px solid var(--color-bg)",
                  padding: "9px 12px",
                }}
              >
                Request 60-minute access
              </button>
            </div>
          )}

          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-neutral-700)" }}>
            <DarkKicker>Billing</DarkKicker>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9, fontSize: 12 }}>
              {tenantBilling.map((b) => (
                <DarkStatRow
                  key={b.label}
                  label={b.label}
                  value={b.value}
                  valueColor={b.hot ? "var(--color-accent-400)" : undefined}
                />
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <DarkKicker>Account notes</DarkKicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 11,
                fontSize: 12,
                color: "var(--color-neutral-400)",
              }}
            >
              {accountNotes.map((n) => (
                <div key={`${n.when}-${n.note}`}>
                  <b style={{ color: "var(--color-bg)" }}>{n.when}</b> — {n.note}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
