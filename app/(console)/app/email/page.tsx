import Link from "next/link";
import { after } from "next/server";
import { ConnectInbox, InboxControls } from "@/components/Inbox";
import { Kicker, ScreenHeader, ScreenRefusal } from "@/components/ui";
import { checkInbox, connectInbox, disconnectInbox } from "@/lib/actions/email";
import { can } from "@/lib/auth/permissions";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { sealingReady } from "@/lib/data/crypto";
import { PROVIDERS, emailThreads, mailboxFor, syncIfStale } from "@/lib/email/mailbox";

/**
 * Email: the customers who write in rather than call or chat.
 *
 * The business connects the inbox its customers write to. Corva reads new
 * mail, keeps what customers wrote and the business's replies, and puts each
 * thread on that customer's record. Replying still happens in the business's
 * own mail client; this screen is where it is seen, counted and followed up.
 */
export default async function EmailPage() {
  const { session, brand, denied } = await guardScreen("customers.read");
  if (denied) {
    return <ScreenRefusal title="Email" reason={refusalReason(denied)} next="Ask an owner or admin if you need to see customer email." />;
  }
  const canManage = can(session.actor, "people.manage", { brandId: brand.id }).allowed;
  const box = await mailboxFor(brand.id);

  if (!box) {
    return (
      <section>
        <ScreenHeader kicker={brand.name} title="Email" lede="See the customers who write to you, next to the ones who call and chat." />
        <div style={{ padding: "20px 24px" }}>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "72ch", lineHeight: 1.5 }}>
            Connect the inbox your customers write to. Corva reads new mail as it arrives, works out which messages are
            from customers, and adds each one to that customer&rsquo;s record — creating the customer if they are new.
            Your replies, sent from your own mail app as usual, are added to the thread. Newsletters, receipts and mail
            from colleagues are not kept. Corva only reads: it never sends, moves or deletes mail.
          </p>
          {canManage ? (
            <ConnectInbox ready={sealingReady()} providers={PROVIDERS.map((p) => ({ ...p }))} onConnect={connectInbox} />
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)" }}>An owner or admin can connect the inbox.</p>
          )}
        </div>
      </section>
    );
  }

  // Read what has arrived since the last look, after this page has been sent.
  after(() => syncIfStale(brand));

  const threads = await emailThreads(brand.id);
  const waiting = threads.filter((t) => !t.outcome).length;
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <section>
      <ScreenHeader kicker={`${brand.name} · ${box.address}`} title="Email" lede={`${waiting} awaiting a reply · ${box.kept} from customers out of ${box.seen} read`}>
        <InboxControls canManage={canManage} onCheck={checkInbox} onDisconnect={disconnectInbox} />
      </ScreenHeader>

      <div style={{ padding: "10px 24px", fontSize: 11.5, color: "var(--color-neutral-700)", borderBottom: "1px solid var(--color-neutral-300)" }}>
        {box.lastError ? (
          <b role="alert" style={{ color: "var(--color-accent-700)" }}>
            The last read failed: {box.lastError}
          </b>
        ) : box.lastSyncedAt ? (
          `Last read ${when(box.lastSyncedAt)}. New mail is read whenever this screen or the overview is opened.`
        ) : (
          "Not read yet."
        )}
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {threads.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 18 }}>
            No customer email yet. When a customer writes to {box.address}, the thread appears here and on their record.
          </p>
        )}
        {threads.map((t) => (
          <Link
            key={t.id}
            href={`/app/conversations/${t.id}`}
            className="hov-row m-stack m-gap-s"
            style={{ display: "grid", gridTemplateColumns: "220px 1fr 150px 120px", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--color-neutral-300)", alignItems: "baseline", fontSize: 12.5 }}
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
        ))}
      </div>
    </section>
  );
}
