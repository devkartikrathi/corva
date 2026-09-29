import { getConsoleContext } from "@/lib/auth/context";
import { demoEnabled } from "@/lib/auth/demo";
import { can } from "@/lib/auth/permissions";
import { setAvailability } from "@/lib/actions/handoffs";
import { acceptHandoff, declineHandoff } from "@/lib/actions/handoffs";
import { switchBrand, switchProfile } from "@/lib/actions/session";
import { conversationStats } from "@/lib/queries/conversations";
import { switchableProfiles } from "@/lib/queries/workspace";
import { visibleNavGroups } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { TransferAlert } from "@/components/TransferAlert";

export const metadata = {
  title: "Corva",
};

/** The tenant console: fixed sidebar, sticky top bar, one scrolling pane. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Every /app route passes through here, so this is the gate. Pages call the
  // same memoised context again for the brand they need.
  const { session, brand, brands, isDemo } = await getConsoleContext();
  const [stats, profiles] = await Promise.all([
    conversationStats(brand.id),
    demoEnabled() ? switchableProfiles(session.orgId) : Promise.resolve([]),
  ]);

  // Only somebody who can be handed a customer gets the alert, or the
  // availability control that feeds it. An Analyst reading the archive should
  // never have a live call thrown at them.
  const takesCalls = can(session.actor, "calls.handle", { brandId: brand.id }).allowed;

  return (
    <div
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
        userName={session.name}
        userRole={`${session.role[0].toUpperCase()}${session.role.slice(1)}`}
        membershipId={session.membershipId}
        availability={session.availability}
        profiles={profiles}
        canSwitchProfile={demoEnabled() && profiles.length > 1}
        canTakeCalls={takesCalls}
        counts={{ live: stats.live, waiting: stats.waiting }}
        groups={visibleNavGroups(session.actor)}
        onSwitchBrand={switchBrand}
        onSwitchProfile={switchProfile}
        onSetAvailability={setAvailability}
      />
      <main style={{ overflow: "auto", position: "relative" }}>
        {/* The console's layouts are built for a wide viewport; below this the
            main pane scrolls sideways rather than reflowing. */}
        <div style={{ minWidth: 1180 }}>
          <TopBar live={stats.live} waiting={stats.waiting} signedIn={!isDemo} />
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
