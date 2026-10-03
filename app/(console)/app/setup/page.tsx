import { PrimaryButton, ScreenHeader, ScreenRefusal, SectionTitle } from "@/components/ui";
import { DEMO_MODE } from "@/lib/auth/mode";
import { ApiKeys } from "@/components/ApiKeys";
import { accountState } from "@/lib/billing/usage";
import { Webhooks } from "@/components/Webhooks";
import { PaymentEndpoint } from "@/components/PaymentEndpoint";
import { paymentEndpointFor } from "@/lib/payments";
import { collectionFor, owedToBusiness } from "@/lib/payments/hosted";
import { formatRupees } from "@/lib/money";
import { SmsSettings } from "@/components/SmsSettings";
import { SMS_PURPOSES, recentSms, smsSettingsFor, smsTemplatesFor } from "@/lib/sms";
import { saveSmsSetup, saveSmsTemplateAction, sendTestSms } from "@/lib/actions/sms";
import { connectPaymentEndpoint, disconnectPaymentEndpoint } from "@/lib/actions/payments";
import { WEBHOOK_EVENTS } from "@/lib/integrations/webhooks";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import {
  AddBrand,
  BrandLiveToggle,
  PhoneNumberField,
  HoursRow,
  PrivacyForm,
} from "@/components/SetupControls";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { can } from "@/lib/auth/permissions";
import {
  createBrand,
  createKey,
  createWebhook,
  deleteWebhook,
  revokeKey,
  testWebhook,
  setBrandLive,
  setBusinessHours,
  setChannel,
  setPrivacy,
} from "@/lib/actions/setup";
import { getSetup } from "@/lib/queries/workspace";
import Link from "next/link";
import { emailInboxFor, inboxAddress } from "@/lib/email/inbound";
import { whatsappFor } from "@/lib/whatsapp/cloud";

/** Every channel Corva can answer, so a disconnected one is still listed. */
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
  const hooks = await db.select().from(s.webhooks).where(eq(s.webhooks.brandId, currentBrand.id)).orderBy(desc(s.webhooks.createdAt));
  const [paymentEndpoint, collection, owed, sms, smsTemplates, smsLog] = await Promise.all([
    paymentEndpointFor(currentBrand.id),
    collectionFor(currentBrand.id),
    owedToBusiness(currentBrand.id),
    smsSettingsFor(currentBrand.id),
    smsTemplatesFor(currentBrand.id),
    recentSms(currentBrand.id, 8),
  ]);
  const { brands, brand, channels, hours, afterHours, privacy, audit: fullAudit, org } = setup;
  // The audit log comes with the Growth plan (and the pilot, which shows everything).
  const account = await accountState(session.orgId);
  const audit = account.plan.management ? fullAudit : [];

  const manages = can(session.actor, "billing.manage").allowed;
  const phoneNumber = channels.find((c) => c.kind === "phone" && c.connected)?.detail ?? "";
  const agentName = brand?.agentName ?? "the assistant";
  const [whatsapp, mailbox] = brand ? await Promise.all([whatsappFor(brand.id), emailInboxFor(brand.id)]) : [null, null];
  // One line per way in: what it is, whether it is on, and where to set it up.
  const reach = [
    {
      name: "Website chat",
      what: `${agentName} answers the chat on your website. Your developer connects it with an API key (below).`,
      on: true,
      status: "On",
      link: { label: "How to connect", href: "/developers" },
    },
    {
      name: "Website voice",
      what: `A call button on your website: customers talk to ${agentName} from their browser.`,
      on: true,
      status: "On",
      link: { label: "Try it", href: "/app/try" },
    },
    {
      name: "WhatsApp",
      what: whatsapp ? `${agentName} answers messages to ${whatsapp.displayNumber}.` : `Connect your WhatsApp Business number and ${agentName} answers on it.`,
      on: Boolean(whatsapp),
      status: whatsapp ? "Connected" : "Not connected",
      link: { label: whatsapp ? "Manage" : "Connect", href: "/app/whatsapp" },
    },
    {
      name: "Email",
      what: mailbox?.received
        ? `Customer email forwarded to ${inboxAddress(mailbox) ?? "your Corva address"} lands on their records, and you reply from Corva.`
        : "Forward customer email to your Corva address and it appears beside the calls and chats; reply from Corva.",
      on: Boolean(mailbox?.received),
      status: mailbox?.received ? "Receiving" : "Not set up",
      link: { label: mailbox?.received ? "Manage" : "Set up", href: "/app/email" },
    },
  ];

  const phone = channels.find((c) => c.kind === "phone" && c.live);

  return (
    <section style={{ position: "relative" }}>
      <ScreenHeader kicker={`Workspace · ${session.orgName}`} title="Settings">
        {DEMO_MODE && phone && (
          <PrimaryButton href="/app/try?mode=call">Call {phone.detail} →</PrimaryButton>
        )}
        {manages && <AddBrand onCreate={createBrand} />}
      </ScreenHeader>

      <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* Brands, channels, hours */}
        <div className="m-noborder-x" style={{ borderRight: "2px solid var(--color-divider)" }}>
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
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>How customers reach {brand?.name ?? "you"}</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Each way a customer can reach you, and whether {agentName} answers on it.
            </p>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
              {reach.map((r) => (
                <div
                  key={r.name}
                  className="m-stack m-gap-s" style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-neutral-300)", alignItems: "start" }}
                >
                  <b>{r.name}</b>
                  <span style={{ color: "var(--color-neutral-800)", lineHeight: 1.5 }}>{r.what}</span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <StatusPill live={r.on}>{r.status}</StatusPill>
                    {r.link && (
                      <Link href={r.link.href} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>
                        {r.link.label} →
                      </Link>
                    )}
                  </span>
                </div>
              ))}
              <div className="m-stack m-gap-s" style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "12px 0 2px", alignItems: "start" }}>
                <b>Your phone number</b>
                <span>
                  {manages && brand ? (
                    <PhoneNumberField
                      number={phoneNumber}
                      onSave={async (number) => {
                        "use server";
                        await setChannel({ brandId: brand.id, kind: "phone", address: number, detail: number, state: number ? "live" : "not_connected" });
                      }}
                    />
                  ) : (
                    <span>{phoneNumber || "Not set"}</span>
                  )}
                  <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5, maxWidth: "60ch" }}>
                    The number {agentName} gives customers who want to call you. It does not connect a telephone line to{" "}
                    {agentName}: calls to it still ring your phone.
                  </span>
                </span>
              </div>
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
        <div className="m-rail">
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>Website &amp; API keys</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Your website&rsquo;s server uses a key to send Corva its chats, pickup and callback requests,
              visitors (with their cookie consent) and to start voice calls with {brand?.agentName ?? "your assistant"}.
              Keep keys on the server — never in the browser.{" "}
              <a href="/developers" target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                Developer docs →
              </a>
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
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>Webhooks</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Corva can tell your own systems the moment something happens — a new lead, a follow-up, the AI asking
              for a person, a conversation ending. Each delivery is signed so your server can trust it.{" "}
              <a href="/developers#webhooks" target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                How to receive them →
              </a>
            </p>
            <Webhooks
              hooks={hooks.map((h) => ({
                id: h.id,
                url: h.url,
                events: h.events,
                last: h.lastDeliveryAt ? h.lastDeliveryAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null,
                lastStatus: h.lastStatus,
                lastError: h.lastError,
              }))}
              events={WEBHOOK_EVENTS.map((e) => ({ type: e.type, description: e.description }))}
              onCreate={createWebhook}
              onDelete={deleteWebhook}
              onTest={testWebhook}
            />
          </div>

          <div id="payments" style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>Payments</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Let the team and the AI ask customers to pay — on a chat, WhatsApp or a call. Your own system makes
              the payment link (with your own payment account, so the money never passes through Corva) and tells
              Corva when it is paid.{" "}
              <a href="/developers#payments" target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                What your endpoint does →
              </a>
            </p>
            {collection && !paymentEndpoint && (
              <p style={{ margin: "0 0 12px", padding: "9px 12px", border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", fontSize: 12, lineHeight: 1.5 }}>
                <b>Corva collects payments for you.</b> Links are made on Corva&rsquo;s payment account and the money is paid out to
                you{collection.feeBasisPoints ? `, less a ${collection.feeBasisPoints / 100}% fee` : ""}
                {collection.payoutNote ? ` (${collection.payoutNote})` : ""}. Waiting to be paid out:{" "}
                <b>{formatRupees(owed.owedPaise, { decimals: "auto" })}</b>. Connect your own payment system below to collect directly instead.
              </p>
            )}
            <PaymentEndpoint
              current={
                paymentEndpoint
                  ? {
                      url: paymentEndpoint.url,
                      last: paymentEndpoint.lastCalledAt ? paymentEndpoint.lastCalledAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null,
                      lastStatus: paymentEndpoint.lastStatus,
                      lastError: paymentEndpoint.lastError,
                    }
                  : null
              }
              onConnect={connectPaymentEndpoint}
              onDisconnect={disconnectPaymentEndpoint}
            />
          </div>

          <div id="sms" style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <div style={{ marginBottom: 6 }}>
              <SectionTitle size={16}>SMS</SectionTitle>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
              Texts to customers — a payment link, a callback arranged, a booking confirmed — from your own SMS account.
              In India every SMS must come from a DLT-registered sender and match an approved template, so add each message
              here exactly as it was approved, with {"{#var#}"} where a value goes. Conversations happen on WhatsApp; SMS
              is for notices. Start in test mode to see what would be sent.
            </p>
            <SmsSettings
              current={{
                provider: sms?.provider ?? "log",
                enabled: sms?.enabled ?? false,
                senderId: sms?.senderId ?? "",
                dltEntityId: sms?.dltEntityId ?? "",
                hasCredentials: Boolean(sms?.credentials),
              }}
              purposes={SMS_PURPOSES}
              templates={smsTemplates.map((t) => ({ purpose: t.purpose, body: t.body, dltTemplateId: t.dltTemplateId ?? "", providerTemplateId: t.providerTemplateId ?? "", enabled: t.enabled }))}
              messages={smsLog.map((m) => ({
                id: m.id,
                to: m.to,
                purpose: m.purpose,
                body: m.body,
                status: m.status,
                error: m.error,
                at: m.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
              }))}
              onSave={saveSmsSetup}
              onSaveTemplate={saveSmsTemplateAction}
              onTest={sendTestSms}
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
                  {account.plan.management ? (
                    "Nothing recorded yet."
                  ) : (
                    <>
                      Who changed what, and when, comes with the Growth plan.{" "}
                      <a href="/app/billing" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                        See plans →
                      </a>
                    </>
                  )}
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
