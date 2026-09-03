/** Resolves to whoever is at the top of the priority queue. */
export const PROFILE_HREF = "/app/customer-360";

export type NavItem = {
  href: string;
  label: string;
  /**
   * Which live count to show on the right of the row. The number itself is
   * resolved per request, so a badge can never disagree with the screen it
   * points at. Accent = happening now, outline = waiting for someone.
   */
  badge?: { count: "live" | "waiting"; accent: boolean };
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { href: "/app", label: "Command center" },
      { href: "/app/live", label: "Live calls", badge: { count: "live", accent: true } },
      { href: "/app/handoffs", label: "Handoffs", badge: { count: "waiting", accent: false } },
      { href: "/app/conversations", label: "Conversations" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/app/customers", label: "All customers" },
      { href: PROFILE_HREF, label: "Customer 360" },
      { href: "/app/segments", label: "Segments & rules" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/app/knowledge", label: "Knowledge base" },
      { href: "/app/tuning", label: "AI tuning" },
      { href: "/app/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/app/team", label: "Team & roles" },
      { href: "/app/setup", label: "Setup & channels" },
    ],
  },
];
