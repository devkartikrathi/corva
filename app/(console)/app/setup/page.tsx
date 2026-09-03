import { Bar, LinkAction, OutlineButton, PrimaryButton, ScreenHeader, SectionTitle } from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { hoursFallback, privacy } from "@/lib/data";
import { getSetup } from "@/lib/queries/workspace";

/** A label/value line in one of the settings blocks. */
function SettingRow({ label, value, labelWidth }: { label: string; value: string; labelWidth: number }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ width: labelWidth, color: "var(--color-neutral-800)" }}>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function StatusPill({ children, live }: { children: string; live: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        background: live ? "var(--color-accent-200)" : "var(--color-neutral-200)",
        color: live ? "var(--color-accent-800)" : "var(--color-neutral-800)",
        padding: "3px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export default async function SetupPage() {
  const { session } = await getConsoleContext();
  const setup = await getSetup(session.orgId);
  const { brands, channels, integrations, usage, org } = setup;

  const planUsage = [
    { label: "Plan", value: (org?.plan ?? "trial").replace(/^./, (c) => c.toUpperCase()) },
    { label: "Brands in use", value: `${brands.filter((b) => b.live).length} of ${brands.length}` },
    {
      label: "Contract renews",
      value: org?.renewsAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? "—",
    },
  ];

  return (
    <section>
      <ScreenHeader kicker={`Workspace · ${session.orgName}`} title="Setup & channels">
        <OutlineButton>Billing &amp; plan</OutlineButton>
        <PrimaryButton>Add a brand</PrimaryButton>
      </ScreenHeader>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* Brands, channels, hours */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Brands in this workspace</SectionTitle>
            </div>
            {brands.map((b) => (
              <div
                key={b.initials}
                style={{
                  padding: "12px 0",
                  borderTop: "1px solid var(--color-neutral-300)",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    background: "var(--color-text)",
                    color: "var(--color-bg)",
                    fontWeight: 800,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {b.initials}
                </span>
                <span style={{ flex: 1 }}>
                  <b style={{ fontSize: 13 }}>{b.name}</b>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                    {b.meta}
                  </span>
                </span>
                <StatusPill live={b.live}>{b.status}</StatusPill>
                <LinkAction size={11}>Configure</LinkAction>
              </div>
            ))}
          </div>

          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Channels · {brands[0]?.name ?? "—"}</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {channels.map((c) => (
                <div
                  key={c.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <b style={{ width: 96 }}>{c.name}</b>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{c.detail}</span>
                  {c.connected ? (
                    <StatusPill live={c.live}>{c.status}</StatusPill>
                  ) : (
                    <LinkAction size={11}>Connect</LinkAction>
                  )}
                </div>
              ))}

            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Hours &amp; fallback</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
              {hoursFallback.map((h) => (
                <SettingRow key={h.label} label={h.label} value={h.value} labelWidth={150} />
              ))}
            </div>
          </div>
        </div>

        {/* Integrations, privacy, plan */}
        <div>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Connected systems</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {integrations.map((g) => (
                <div
                  key={g.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <b style={{ width: 130 }}>{g.name}</b>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{g.purpose}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: g.color }}>{g.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Data, privacy &amp; residency</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
              {privacy.map((p) => (
                <SettingRow key={p.label} label={p.label} value={p.value} labelWidth={168} />
              ))}
            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Plan &amp; usage</SectionTitle>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
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
                {(org?.plan ?? "trial").replace(/^./, (c) => c.toUpperCase())}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--color-neutral-700)" }}>
                £0.31 per resolved conversation · unlimited seats
              </span>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 11,
                fontSize: 12.5,
              }}
            >
              <div>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
                    Conversations this month
                  </span>
                  <b>
                    {usage.conversations.toLocaleString("en-GB")} /{" "}
                    {usage.allowance.toLocaleString("en-GB")}
                  </b>
                </div>
                <Bar
                  width={`${Math.min(100, Math.round((usage.conversations / usage.allowance) * 100))}%`}
                  color="var(--color-accent)"
                  style={{ marginTop: 5 }}
                />
              </div>
              {planUsage.map((p) => (
                <div key={p.label} style={{ display: "flex", gap: 12 }}>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{p.label}</span>
                  <b>{p.value}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
