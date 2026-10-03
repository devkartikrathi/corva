import Link from "next/link";
import { CopyAddress, EmailReply } from "@/components/Inbox";
import { Kicker, ScreenHeader, ScreenRefusal } from "@/components/ui";
import { replyToEmail } from "@/lib/actions/email";
import { can } from "@/lib/auth/permissions";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { emailThreads, inboundDomain, inboxAddress, inboxFor } from "@/lib/email/inbound";

/**
 * Email: the customers who write in rather than call or chat.
 *
 * The business forwards customer mail to its Corva address; each message
 * arrives the moment it is forwarded, lands on the customer's record, and is
 * answered from here. Replies go out in the business's name and come back to
 * the same thread. See lib/email/inbound.ts.
 */
export default async function EmailPage() {
  const { session, brand, denied } = await guardScreen("customers.read");
  if (denied) {
    return <ScreenRefusal title="Email" reason={refusalReason(denied)} next="Ask an owner or admin if you need to see customer email." />;
  }
  const canManage = can(session.actor, "people.manage", { brandId: brand.id }).allowed;
  const canReply = can(session.actor, "calls.handle", { brandId: brand.id }).allowed;
  const [inbox, threads] = await Promise.all([inboxFor(brand.id, brand.slug), emailThreads(brand.id)]);
  const address = inboxAddress(inbox);
  const waiting = threads.filter((t) => !t.outcome).length;
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const step = { margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--color-neutral-800)" } as const;

  return (
    <section>
      <ScreenHeader
        kicker={brand.name}
        title="Email"
        lede={inbox.received ? `${waiting} awaiting a reply · ${inbox.kept} from customers out of ${inbox.received} received` : "Customers who write in, next to the ones who call and chat."}
      />

      {canManage && (
        <div style={{ padding: "16px 24px", borderBottom: "2px solid var(--color-divider)", maxWidth: 900 }}>
          {!inboundDomain() ? (
            <p style={{ ...step, color: "var(--color-accent-700)", fontWeight: 700 }}>
              Receiving email is not switched on for Corva yet (RESEND_INBOUND_DOMAIN). Once it is, your address appears here.
            </p>
          ) : (
            <>
              <Kicker>Your Corva email address</Kicker>
              <div style={{ margin: "8px 0 12px" }}>
                <CopyAddress address={address!} />
              </div>
              <p style={step}>
                Forward your customers&rsquo; email to it and each message lands here the moment it is forwarded, on that
                customer&rsquo;s record. Reply from Corva: the customer gets your reply in your business&rsquo;s name, and
                their answer comes straight back to this screen.
              </p>
              <details open={!inbox.received}>
                <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, margin: "4px 0 8px" }}>How to set it up (two minutes)</summary>
                <p style={step}>
                  <b>Gmail or Google Workspace.</b> Settings → See all settings → <i>Forwarding and POP/IMAP</i> → <i>Add a
                  forwarding address</i> → paste the address above. Gmail sends a confirmation code to it; the code appears
                  just below this, and you type it back into Gmail.
                </p>
                <p style={step}>
                  <b>Send only your customers&rsquo; mail (recommended).</b> Rather than forwarding everything, in Gmail make a
                  filter: Settings → <i>Filters and blocked addresses</i> → <i>Create a new filter</i>. For example{" "}
                  <i>To: your business address</i>, and under <i>Doesn&rsquo;t have</i> words your suppliers and newsletters
                  use — then <i>Forward it to</i> the address above. Corva also drops anything that is not from a customer the
                  moment it arrives, but what you never send, nobody ever sees.
                </p>
                <p style={step}>
                  <b>Outlook or Microsoft 365.</b> Settings → Mail → <i>Rules</i> → add a rule → <i>Forward to</i> the address
                  above. <b>Any other provider</b>: its forwarding setting works the same way.
                </p>
                <p style={step}>
                  <b>One email at a time</b> also works: press <i>Forward</i> on a customer&rsquo;s message and send it to the
                  address above. Corva reads the customer from inside the forwarded message.
                </p>
              </details>
              {inbox.confirmation && (
                <div style={{ marginTop: 8, padding: "10px 12px", border: "2px solid var(--color-accent)", background: "var(--color-surface)", fontSize: 12.5 }}>
                  <b>Forwarding confirmation received</b> from {inbox.confirmation.from}, {when(new Date(inbox.confirmation.at))}.{" "}
                  {inbox.confirmation.code ? (
                    <>
                      Code: <code style={{ fontSize: 15, fontWeight: 800 }}>{inbox.confirmation.code}</code> — type it into your mail&rsquo;s forwarding settings.
                    </>
                  ) : (
                    "Open your mail's forwarding settings to finish."
                  )}
                  {inbox.confirmation.link && (
                    <>
                      {" "}
                      Or{" "}
                      <a href={inbox.confirmation.link} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                        confirm with the link
                      </a>
                      .
                    </>
                  )}
                </div>
              )}
              {inbox.lastReceivedAt && <p style={{ ...step, marginTop: 8, fontSize: 11.5, color: "var(--color-neutral-700)" }}>Last email received {when(inbox.lastReceivedAt)}.</p>}
            </>
          )}
        </div>
      )}

      <div style={{ padding: "0 24px 24px" }}>
        {threads.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 18 }}>
            No customer email yet. When a customer&rsquo;s message is forwarded{address ? ` to ${address}` : ""}, the thread appears here and on their record.
          </p>
        )}
        {threads.map((t) => (
          <div key={t.id} style={{ padding: "13px 0", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Link
              href={`/app/conversations/${t.id}`}
              className="hov-row m-stack m-gap-s"
              style={{ display: "grid", gridTemplateColumns: "220px 1fr 150px 120px", gap: 16, alignItems: "baseline", fontSize: 12.5, color: "var(--color-text)" }}
            >
              <span>
                <b>{t.customerName ?? "Unknown"}</b>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)", overflow: "hidden", textOverflow: "ellipsis" }}>{t.customerEmail}</span>
              </span>
              <span>
                <b>{t.subject || "(no subject)"}</b>
                <span style={{ display: "block", color: "var(--color-neutral-800)", marginTop: 2 }}>{t.summary}</span>
              </span>
              <span>
                {t.outcome ? (
                  <span style={{ color: "var(--color-neutral-700)" }}>Replied{t.handledBy ? ` by ${t.handledBy}` : ""}</span>
                ) : (
                  <Kicker color="var(--color-accent-700)">Awaiting a reply</Kicker>
                )}
              </span>
              <span style={{ textAlign: "right", color: "var(--color-neutral-700)" }}>{when(t.startedAt)}</span>
            </Link>
            {canReply && t.customerEmail && (
              <div style={{ marginTop: 6 }}>
                <EmailReply conversationId={t.id} to={t.customerEmail} onReply={replyToEmail} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
