import Link from "next/link";
import { ConnectWhatsApp, CopyValue, DisconnectWhatsApp, OpeningTemplate } from "@/components/WhatsApp";
import { Kicker, ScreenHeader, ScreenRefusal, SectionTitle } from "@/components/ui";
import { connectWhatsAppNumber, disconnectWhatsAppNumber, saveWhatsAppOpeningTemplate } from "@/lib/actions/whatsapp";
import { can } from "@/lib/auth/permissions";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { sealingReady } from "@/lib/data/crypto";
import { APP_URL } from "@/lib/email";
import { whatsappFor, whatsappThreads } from "@/lib/whatsapp/cloud";

/**
 * WhatsApp: the business's own number, answered by its assistant.
 *
 * A message to the number is answered the way a website chat is, lands in
 * Conversations on the customer's record, and can be taken over by a person,
 * whose replies go to the customer's WhatsApp.
 */

const step = { fontSize: 12.5, lineHeight: 1.55, color: "var(--color-neutral-800)", margin: 0 } as const;

export default async function WhatsAppPage() {
  const { session, brand, denied } = await guardScreen("customers.read");
  if (denied) {
    return <ScreenRefusal title="WhatsApp" reason={refusalReason(denied)} next="Ask an owner or admin if you need to see WhatsApp conversations." />;
  }
  const canManage = can(session.actor, "people.manage", { brandId: brand.id }).allowed;
  const number = await whatsappFor(brand.id);
  const agent = brand.agentName ?? "your assistant";
  const webhook = `${APP_URL}/api/whatsapp/webhook`;

  if (!number) {
    return (
      <section>
        <ScreenHeader kicker={brand.name} title="WhatsApp" lede={`Let ${agent} answer on your WhatsApp number, and take a chat over when it needs a person.`} />
        <div style={{ padding: "20px 24px", display: "grid", gap: 16, maxWidth: 820 }}>
          <p style={step}>
            Corva connects through Meta&rsquo;s own WhatsApp Cloud API, with no reseller in between: you keep the number
            and pay Meta directly. You need a Meta Business account and a number that is not already on the WhatsApp
            phone app.
          </p>
          <ol style={{ ...step, paddingInlineStart: 18, display: "grid", gap: 6 }}>
            <li>
              At <b>developers.facebook.com</b>, create an app of type Business and add the <b>WhatsApp</b> product.
            </li>
            <li>
              Under WhatsApp → API Setup, add your number. Copy its <b>Phone number ID</b>.
            </li>
            <li>
              In Business settings → System users, create a system user, give it the app and the WhatsApp account, and
              generate a token with <b>whatsapp_business_messaging</b> and <b>whatsapp_business_management</b>. That is
              the permanent <b>access token</b>; the temporary one on the setup page stops working after a day.
            </li>
            <li>
              Under App settings → Basic, copy the <b>App secret</b>.
            </li>
            <li>Paste the three below. Corva then shows the address to give Meta.</li>
          </ol>
          {canManage ? (
            <ConnectWhatsApp ready={sealingReady()} onConnect={connectWhatsAppNumber} />
          ) : (
            <p style={step}>An owner or admin can connect the number.</p>
          )}
        </div>
      </section>
    );
  }

  const threads = await whatsappThreads(brand.id);
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const live = Boolean(number.lastInboundAt);

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${number.verifiedName ?? "WhatsApp"}`}
        title={number.displayNumber}
        lede={live ? `Answered by ${agent}. Last message ${when(number.lastInboundAt!)}.` : number.verifiedAt ? "Meta has confirmed the address. Waiting for the first message." : "One step left: give Meta the address below."}
      >
        {canManage && <DisconnectWhatsApp onDisconnect={disconnectWhatsAppNumber} />}
      </ScreenHeader>

      {number.lastError && (
        <div role="alert" style={{ padding: "10px 24px", fontSize: 12, fontWeight: 700, color: "var(--color-accent-700)", borderBottom: "1px solid var(--color-neutral-300)" }}>
          The last reply could not be sent: {number.lastError}
        </div>
      )}

      {canManage && (
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-neutral-300)", display: "grid", gap: 8, maxWidth: 820 }}>
          <SectionTitle size={16}>Writing to a customer first</SectionTitle>
          <p style={{ ...step, margin: 0 }}>
            The assistant only ever answers people who wrote to you. Someone on the team can write first from a
            customer&rsquo;s page — freely within 24 hours of their last message; after that, WhatsApp only allows a
            template Meta has approved (WhatsApp Manager → Message templates, category Utility). Give its name here.
          </p>
          <OpeningTemplate current={number.openingTemplate ?? null} onSave={saveWhatsAppOpeningTemplate} />
        </div>
      )}

      {canManage && !live && (
        <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)", display: "grid", gap: 10, maxWidth: 820 }}>
          <SectionTitle size={16}>Tell Meta where to send messages</SectionTitle>
          <p style={step}>
            In your Meta app, open WhatsApp → Configuration → Webhook → Edit, paste these two, and press Verify and save.
            Then, under Webhook fields, subscribe to <b>messages</b>.
          </p>
          <div>
            <Kicker style={{ marginBottom: 4 }}>Callback URL</Kicker>
            <CopyValue value={webhook} />
          </div>
          <div>
            <Kicker style={{ marginBottom: 4 }}>Verify token</Kicker>
            <CopyValue value={number.verifyToken} />
          </div>
          <p style={{ ...step, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            {number.verifiedAt ? `Verified ${when(number.verifiedAt)}. Send a WhatsApp message to ${number.displayNumber} to try it.` : "Not verified yet."}
          </p>
        </div>
      )}

      <div style={{ padding: "0 24px 24px" }}>
        {threads.length === 0 && <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 18 }}>No WhatsApp conversations yet.</p>}
        {threads.map((t) => (
          <Link
            key={t.id}
            href={`/app/conversations/${t.id}`}
            className="m-stack m-gap-s" style={{ display: "grid", gridTemplateColumns: "220px 1fr 170px 120px", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--color-neutral-300)", alignItems: "baseline", fontSize: 12.5 }}
          >
            <span>
              <b>{t.customerName ?? "Unknown"}</b>
              <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>{t.customerPhone}</span>
            </span>
            <span style={{ color: "var(--color-neutral-800)" }}>{t.summary || t.intent || "—"}</span>
            <span style={{ color: "var(--color-neutral-700)" }}>
              {t.handledBy ? `With ${t.handledBy}` : t.status === "live" ? `With ${agent}` : t.status === "waiting_human" ? "Waiting for a person" : "Ended"}
            </span>
            <span style={{ textAlign: "right", color: "var(--color-neutral-700)" }}>{when(t.startedAt)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
