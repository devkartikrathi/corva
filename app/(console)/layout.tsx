import { getConsoleContext } from "@/lib/auth/context";
import { switchBrand } from "@/lib/actions/session";
import { conversationStats } from "@/lib/queries/conversations";
import { visibleNavGroups } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export const metadata = {
  title: "Corva",
};

/** The tenant console: fixed sidebar, sticky top bar, one scrolling pane. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Every /app route passes through here, so this is the gate. Pages call the
  // same memoised context again for the brand they need.
  const { session, brand, brands } = await getConsoleContext();
  const stats = await conversationStats(brand.id);

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
        counts={{ live: stats.live, waiting: stats.waiting }}
        groups={visibleNavGroups(session.actor)}
        onSwitchBrand={switchBrand}
      />
      <main style={{ overflow: "auto", position: "relative" }}>
        {/* The console's layouts are built for a wide viewport; below this the
            main pane scrolls sideways rather than reflowing. */}
        <div style={{ minWidth: 1180 }}>
          <TopBar live={stats.live} waiting={stats.waiting} />
          {children}
        </div>
      </main>
    </div>
  );
}
