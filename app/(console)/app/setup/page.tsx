import { PrimaryButton, ScreenHeader, ScreenRefusal, SectionTitle } from "@/components/ui";
import { DEMO_MODE } from "@/lib/auth/mode";
import { ApiKeys } from "@/components/ApiKeys";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import {
  AddBrand,
  BrandLiveToggle,
  ChannelRow,
  HoursRow,
  PrivacyForm,
} from "@/components/SetupControls";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { can } from "@/lib/auth/permissions";
import {
  createBrand,
  createKey,
  revokeKey,
  setBrandLive,
  setBusinessHours,
  setChannel,
  setPrivacy,
} from "@/lib/actions/setup";
import { getSetup } from "@/lib/queries/workspace";

/** Every channel Corva can answer, so a disconnected one is still listed. */
const ALL_CHANNELS = [
  { kind: "phone", name: "Phone" },
  { kind: "whatsapp", name: "WhatsApp" },
  { kind: "web_chat", name: "Web chat" },
  { kind: "email", name: "Email" },
  { kind: "sms", name: "SMS" },
] as const;

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
  const { session, brand: currentBrand, denied } = await guardScreen("people.manage");
  // The nav withholds this screen; this is what makes withholding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="Setup & channels"
        reason={refusalReason(denied)}
        next="Which channels are live shows on the command centre."
      />
    );
  }

  const setup = await getSetup(session.orgId, currentBrand.id);
  const keys = await db
    .select()
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.brandId, currentBrand.id), isNull(s.apiKeys.revokedAt)))
    .orderBy(desc(s.apiKeys.createdAt));
  const { brands, brand, channels, hours, afterHours, privacy, audit, org } = setup;

  const manages = can(session.actor, "billing.manage").allowed;
  const channelBy = new Map(channels.map((c) => [c.kind, c]));

  const phone = channels.find((c) => c.kind === "phone" && c.live);

  return (
    <section style={{ position: "relative" }}>
      <ScreenHeader kicker={`Workspace · ${session.orgName}`} title="Settings">
        {DEMO_MODE && phone && (
          <PrimaryButton href={`/operator/testing?dial=${encodeURIComponent(phone.detail)}`}>
            Call {phone.detail} →
          </PrimaryButton>
        )}
        {manages && <AddBrand onCreate={createBrand} />}
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
                key={b.id}
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
                {manages && (
                  <BrandLiveToggle
                    brandId={b.id}
                    live={b.live}
                    name={b.name}
                    onToggle={setBrandLive}
                  />
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Channels · {brand?.name ?? "—"}</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {ALL_CHANNELS.map((definition) => {
                const c = channelBy.get(definition.kind);
                const connected = c ? c.state !== "not_connected" : false;
                return (
                  <div
                    key={definition.kind}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      paddingBottom: 10,
                      borderBottom: "1px solid var(--color-neutral-300)",
                    }}
                  >
                    <b style={{ width: 96 }}>{definition.name}</b>
                    <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
                      {c?.detail ?? "Not connected"}
                    </span>
                    {connected && <StatusPill live={c!.live}>{c!.status}</StatusPill>}
                    {manages && brand && (
                      <ChannelRow
                        brandId={brand.id}
                        kind={definition.kind}
                        name={definition.name}
                        address={c?.detail ?? ""}
                        detail={c?.detail ?? ""}
                        state={c?.state ?? "not_connected"}
                        onSave={async (input) => {
                          "use server";
                          await setChannel({
                            brandId: input.brandId,
                            kind: input.kind as (typeof ALL_CHANNELS)[number]["kind"],
                            address: input.address,
                            detail: input.detail,
                            state: input.state,
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "18px 24px" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Hours &amp; fallback</SectionTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {hours.map((h) =>
                manages && brand ? (
                  <HoursRow
                    key={h.weekday}
                    brandId={brand.id}
                    weekday={h.weekday}
                    day={h.day}
                    closed={h.closed}
                    opens={h.opens}
                    closes={h.closes}
                    onSave={setBusinessHours}
                  />
                ) : (
                  <SettingRow key={h.weekday} label={h.day} value={h.label} labelWidth={96} />
                ),
              )}
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 10,
                  borderTop: "1px solid var(--color-neutral-300)",
                }}
              >
                <SettingRow label="Outside those hours" value={afterHours} labelWidth={150} />
                <div style={{ marginTop: 8 }}>
                  <SettingRow label="Timezone" value={brand?.timezone ?? "—"} labelWidth={150} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Integrations, privacy, plan */}
        <div>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>Website &amp; API keys</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Your website&rsquo;s server uses a key to send Corva its chats, pickup and callback requests,
              visitors (with their cookie consent) and to start voice calls with {brand?.agentName ?? "your assistant"}.
              Keep keys on the server — never in the browser.
            </p>
            <ApiKeys
              keys={keys.map((k) => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                lastUsed: k.lastUsedAt ? k.lastUsedAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null,
                created: k.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
              }))}
              onCreate={createKey}
              onRevoke={revokeKey}
            />
          </div>

          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 12 }}>
              <SectionTitle size={16}>Data, privacy &amp; residency</SectionTitle>
            </div>
            {manages ? (
              <PrivacyForm
                initial={{
                  retentionDays: privacy?.retentionDays ?? 365,
                  redactPii: privacy?.redactPii ?? true,
                  trainOnTranscripts: privacy?.trainOnTranscripts ?? false,
                  recordCalls: privacy?.recordCalls ?? true,
                  allowSupportAccess: privacy?.allowSupportAccess ?? true,
                  dpoEmail: privacy?.dpoEmail ?? "",
                }}
                region={org?.region ?? "—"}
                onSave={setPrivacy}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
                <SettingRow
                  label="Transcript retention"
                  value={`${privacy?.retentionDays ?? 365} days`}
                  labelWidth={168}
                />
                <SettingRow
                  label="Personal data redacted"
                  value={privacy?.redactPii ? "Yes" : "No"}
                  labelWidth={168}
                />
                <SettingRow
                  label="Transcripts train the model"
                  value={privacy?.trainOnTranscripts ? "Yes" : "No"}
                  labelWidth={168}
                />
                <SettingRow
                  label="Corva staff may request access"
                  value={privacy?.allowSupportAccess ? "Yes, time-boxed" : "No"}
                  labelWidth={168}
                />
                <SettingRow label="Residency" value={org?.region ?? "—"} labelWidth={168} />
              </div>
            )}
            {privacy?.updatedBy && (
              <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--color-neutral-700)" }}>
                Last changed by {privacy.updatedBy} on{" "}
                {privacy.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
              </p>
            )}
          </div>

          {/* Audit log. Tenant-visible on purpose: it is what makes the
              support-access promise checkable rather than a claim. */}
          <div id="audit" style={{ padding: "18px 24px" }}>
            <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 10 }}>
              <SectionTitle size={16}>Audit log</SectionTitle>
              <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
                last {audit.length} entries
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              {audit.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Nothing recorded yet.
                </span>
              )}
              {audit.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    paddingBottom: 7,
                    borderBottom: "1px solid var(--color-neutral-300)",
                  }}
                >
                  <span
                    style={{
                      width: 110,
                      color:
                        a.actorType === "staff" ? "var(--color-accent-700)" : "var(--color-text)",
                      fontWeight: 600,
                    }}
                  >
                    {a.who}
                  </span>
                  <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>
                    {a.action}
                    {a.target ? ` · ${a.target}` : ""}
                  </span>
                  <span style={{ color: "var(--color-neutral-700)" }}>{a.when}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
              Corva staff reads appear here in accent, alongside your own team&rsquo;s changes. That
              is what makes &ldquo;we cannot read your transcripts without a grant&rdquo; something
              you can check rather than something we say.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
