import { getConsoleContext } from "@/lib/auth/context";
import { demoEnabled } from "@/lib/auth/demo";
import { can } from "@/lib/auth/permissions";
import { setAvailability } from "@/lib/actions/handoffs";
import { acceptHandoff, declineHandoff } from "@/lib/actions/handoffs";
import { createTestAccounts, switchBrand, switchProfile, viewAs } from "@/lib/actions/session";
import { testAccounts } from "@/lib/auth/view-as";
import { HeaderControls } from "@/components/HeaderControls";
import { conversationStats } from "@/lib/queries/conversations";
import { switchableProfiles } from "@/lib/queries/workspace";
import { visibleNavGroups } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { TransferAlert } from "@/components/TransferAlert";
import { accountState } from "@/lib/billing/usage";

export const metadata = {
  title: "Corva",
};

/** The tenant console: fixed sidebar, sticky top bar, one scrolling pane. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Every /app route passes through here, so this is the gate. Pages call the
  // same memoised context again for the brand they need.
  const { session, brand, brands, isDemo, viewingAs } = await getConsoleContext();
  // An owner (or an owner already looking through a test account) may switch roles.
  const canViewAs = !isDemo && (viewingAs !== null || session.role === "owner");
  const [stats, profiles, account, tests] = await Promise.all([
    conversationStats(brand.id),
    demoEnabled() ? switchableProfiles(session.orgId) : Promise.resolve([]),
    accountState(session.orgId),
    canViewAs ? testAccounts(session.orgId) : Promise.resolve([]),
  ]);

  // Said on every screen, because an assistant that has stopped answering is
  // not something to discover from a customer.
  const noun = account.plan.id === "pilot" ? "pilot" : "plan";
  const planNotice =
    account.status === "lapsed"
      ? `Your ${noun} has ended and ${brand.agentName ?? "the assistant"} has stopped taking new conversations.`
      : account.status === "grace"
        ? `Your ${noun} has ended. ${brand.agentName ?? "The assistant"} keeps answering for a few more days.`
        : account.exhausted.chats || account.exhausted.voice
          ? `The pilot's ${account.exhausted.chats ? "chats" : "voice minutes"} are used up, so ${brand.agentName ?? "the assistant"} has stopped taking new ${account.exhausted.chats ? "chats" : "calls"}.`
          : account.daysLeft <= 3
            ? `Your ${noun} ends in ${account.daysLeft} day${account.daysLeft === 1 ? "" : "s"}.`
            : null;

  // Only somebody who can be handed a customer gets the alert, or the
  // availability control that feeds it. An Analyst reading the archive should
  // never have a live call thrown at them.
  const takesCalls = can(session.actor, "calls.handle", { brandId: brand.id }).allowed;

  return (
    <div
      className="cv-shell"
      style={{
        display: "grid",
        gridTemplateColumns: "232px 1fr",
        height: "100vh",
        overflow: "hidden",
        fontVariantNumeric: "tabular-nums",
        fontSize: 13,
      }}
    >
      <Sidebar
        brand={{ id: brand.id, name: brand.name, initials: brand.initials, isLive: brand.isLive }}
        brands={brands.map((b) => ({ id: b.id, name: b.name, initials: b.initials, isLive: b.isLive }))}
        orgName={session.orgName}
        counts={{ live: stats.live, waiting: stats.waiting }}
        groups={visibleNavGroups(session.actor)}
        onSwitchBrand={switchBrand}
      />
      <main className="cv-main" style={{ overflow: "auto", position: "relative" }}>
        {/* Between a tablet and this width the main pane scrolls sideways
            rather than reflowing; on a phone the floor is lifted and each
            screen stacks — see "Small screens" in globals.css. */}
        <div className="cv-main-inner" style={{ minWidth: 1180 }}>
          <TopBar
            live={stats.live}
            waiting={stats.waiting}
            signedIn={!isDemo}
            controls={
              <HeaderControls
                me={{ id: session.membershipId, name: session.name, role: session.role }}
                availability={session.availability}
                canTakeCalls={takesCalls}
                onSetAvailability={setAvailability}
                viewAs={
                  canViewAs
                    ? { realName: viewingAs?.realName ?? session.name, viewing: viewingAs !== null, accounts: tests, onViewAs: viewAs, onCreate: createTestAccounts }
                    : null
                }
                demo={demoEnabled() ? { profiles, onSwitch: switchProfile } : null}
              />
            }
          />
          {viewingAs && (
            <div className="m-pad" style={{ padding: "7px 24px", fontSize: 12, background: "var(--color-text)", color: "var(--color-bg)", display: "flex", gap: 10, alignItems: "center" }}>
              <span>
                You are looking at the console as <b>{session.name}</b> ({session.role}). Everything here is what that role sees and may do.
              </span>
              <form
                action={async () => {
                  "use server";
                  await viewAs(null);
                }}
                style={{ marginLeft: "auto" }}
              >
                <button type="submit" style={{ fontSize: 11.5, fontWeight: 700, textDecoration: "underline", color: "var(--color-bg)" }}>
                  Back to {viewingAs.realName}
                </button>
              </form>
            </div>
          )}
          {planNotice && (
            <a
              href="/app/billing"
              className="m-pad"
              style={{
                display: "block",
                padding: "9px 24px",
                fontSize: 12.5,
                fontWeight: 700,
                background: account.status === "active" && !account.exhausted.chats && !account.exhausted.voice ? "var(--color-accent-100)" : "var(--color-accent)",
                color: account.status === "active" && !account.exhausted.chats && !account.exhausted.voice ? "var(--color-accent-800)" : "var(--color-bg)",
              }}
            >
              {planNotice} {account.plan.id === "pilot" ? "Choose a plan" : "Renew"} in Billing →
            </a>
          )}
          {children}
        </div>
      </main>

      {/*
        Mounted at the layout, not on the Handoffs screen, because the whole
        point is that it reaches you wherever you are — a handoff you only
        find out about when you next open the queue is a handoff a live
        customer has already been waiting through.
      */}
      {takesCalls && <TransferAlert onAccept={acceptHandoff} onDecline={declineHandoff} />}
    </div>
  );
}
