import { can, type Actor, type Capability } from "./auth/permissions";

/** Resolves to whoever is at the top of the priority queue. */
export const PROFILE_HREF = "/app/customer-360";

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
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      // Everyone gets a landing screen, whatever else they can reach.
      { href: "/app", label: "Command center" },
      { href: "/app/live", label: "Live calls", capability: "calls.handle", badge: { count: "live", accent: true } },
      { href: "/app/handoffs", label: "Handoffs", capability: "calls.handle", badge: { count: "waiting", accent: false } },
      { href: "/app/conversations", label: "Conversations", capability: "customers.read" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/app/customers", label: "All customers", capability: "customers.read" },
      { href: PROFILE_HREF, label: "Customer 360", capability: "customers.read" },
      // The model itself, not one customer's score — the "why this number"
      // breakdown a manager needs lives on the profile instead.
      { href: "/app/segments", label: "Segments & rules", capability: "scoring.edit" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/app/knowledge", label: "Knowledge base", capability: "documents.publish" },
      { href: "/app/tuning", label: "AI tuning", capability: "agent.edit" },
      { href: "/app/analytics", label: "Analytics", capability: "customers.read" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/app/team", label: "Team & roles", capability: "people.manage" },
      /**
       * Setup is gated on `people.manage` rather than `billing.manage`, which
       * is Owner-only. An Admin has to be able to connect a channel without
       * being able to change the plan — so the screen is reachable by whoever
       * administers the workspace, and the billing controls inside it check
       * `billing.manage` separately.
       */
      { href: "/app/setup", label: "Setup & channels", capability: "people.manage" },
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
      items: group.items.filter((item) => {
        if (!item.capability) return true;
        // `allowed: false` with a grant of read_only or propose still means
        // "you may look", which is a reason to show the screen.
        const decision = can(actor, item.capability);
        return decision.grant !== "none";
      }),
    }))
    .filter((group) => group.items.length > 0);
}
