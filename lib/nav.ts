import { can, type Actor, type Capability, type Role } from "./auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  /**
   * The capability that makes this screen worth opening. An item is hidden
   * when the person's grant is `none` — not as a security measure (the server
   * checks again on every read and every write) but because a nav full of
   * screens you can do nothing on is how a console stops being legible.
   *
   * `read_only` still shows: seeing the archive without being able to change
   * it is exactly an Analyst's job.
   */
  capability?: Capability;
  badge?: { count: "live" | "waiting"; accent: boolean };
  /**
   * A different word for the same screen, for roles that see a different
   * slice of it.
   *
   * An Agent's customer list is the customers they hold, not the brand's — so
   * calling it "All customers" on their screen would be a small lie in the one
   * place the console is meant to be plainest about scope.
   */
  labelByRole?: Partial<Record<Role, string>>;
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      // Everyone gets a landing screen, whatever else they can reach.
      { href: "/app", label: "Home" },
      { href: "/app/live", label: "Live calls", capability: "calls.handle", badge: { count: "live", accent: true } },
      { href: "/app/handoffs", label: "Handoffs", capability: "calls.handle", badge: { count: "waiting", accent: false } },
      { href: "/app/conversations", label: "Conversations", capability: "customers.read" },
      // Customers who write in, read from the business's own inbox.
      { href: "/app/email", label: "Email", capability: "customers.read" },
    ],
  },
  {
    /**
     * Where the phone line turns into business.
     *
     * Leads and follow-ups are mostly written by the AI during calls; these
     * screens are where the team picks them up. An Agent sees their own — the
     * same scope rule as customers — and a Manager sees everyone's.
     */
    label: "Sales",
    items: [
      { href: "/app/leads", label: "Leads", capability: "customers.read", labelByRole: { agent: "My leads" } },
      { href: "/app/follow-ups", label: "Follow-ups", capability: "calls.handle", labelByRole: { agent: "My follow-ups" } },
      {
        href: "/app/customers",
        label: "Customers",
        capability: "customers.read",
        labelByRole: { agent: "My customers" },
      },
    ],
  },
  {
    label: "AI assistant",
    items: [
      { href: "/app/try", label: "Try it", capability: "calls.handle" },
      { href: "/app/knowledge", label: "Knowledge", capability: "documents.publish" },
      { href: "/app/tuning", label: "Behaviour & limits", capability: "agent.edit" },
      { href: "/app/details", label: "Details to collect", capability: "agent.edit" },
      { href: "/app/data", label: "Your database", capability: "people.manage" },
      { href: "/app/analytics", label: "Analytics", capability: "customers.read" },
    ],
  },
  {
    label: "Team",
    items: [
      /**
       * How the people are doing, as opposed to how the AI is doing.
       *
       * Gated on its own capability rather than on `people.manage`: an Agent
       * should not be reading a league table they are on.
       */
      // The business drawn: customers by channel, who answered, who was at work.
      // Open to everyone; what it shows narrows to your own work down the pyramid.
      { href: "/app/overview", label: "Overview" },
      { href: "/app/attendance", label: "Attendance", labelByRole: { agent: "My attendance" } },
      { href: "/app/performance", label: "Performance", capability: "team.performance" },
      { href: "/app/team", label: "People & roles", capability: "people.manage" },
      { href: "/app/setup", label: "Settings", capability: "people.manage" },
      { href: "/app/billing", label: "Billing", capability: "billing.manage" },
    ],
  },
];

/**
 * The navigation this person should actually see.
 *
 * Rendered from the same matrix the server enforces, so the sidebar cannot
 * offer a screen that would refuse them — and a group that empties out
 * disappears rather than leaving a heading over nothing.
 */
export function visibleNavGroups(actor: Actor) {
  return navGroups
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => {
          if (!item.capability) return true;
          // `allowed: false` with a grant of read_only or propose still means
          // "you may look", which is a reason to show the screen.
          const decision = can(actor, item.capability);
          return decision.grant !== "none";
        })
        .map((item) => ({ ...item, label: item.labelByRole?.[actor.role] ?? item.label })),
    }))
    .filter((group) => group.items.length > 0);
}
