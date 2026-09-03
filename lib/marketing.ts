/**
 * Content for the marketing site, ported from `design/Corva Landing.dc.html`.
 */

export const heroStats = [
  { label: "Resolved without a human", value: "71", suffix: "%", suffixAccent: true },
  { label: "Median time to answer", value: "1.4", suffix: "s", suffixAccent: false },
  { label: "Signals per customer", value: "11" },
  { label: "Handoffs with a written brief", value: "100", suffix: "%", suffixAccent: true },
] as const;

export const logos = ["Aurelius", "Northmoor", "Kessel & Co", "Vantage"] as const;

/** The waveform in the console mock — heights as percentages. */
export const heroWave = [40, 70, 100, 55, 85, 30, 65, 95, 45, 75, 35, 60, 90, 50, 25, 70, 40, 80] as const;

export const knownFacts = [
  { label: "Lifetime value", value: "£14,280", hot: false },
  { label: "Open orders", value: "2", hot: false },
  { label: "Reschedules", value: "3 this month", hot: true },
  { label: "Last NPS", value: "4 · detractor", hot: false },
  { label: "Contract renews", value: "18 Oct", hot: false },
] as const;

export const nextActions = [
  { label: "Waive install fee (£85)", state: "Needs Manager", hot: true },
  { label: "Fixed AM slot · Thu", state: "Auto-approved", hot: false },
  { label: "Flag account for retention", state: "1 click", hot: false },
] as const;

export const loopSteps = [
  {
    n: "01",
    title: "The AI answers",
    body: "A customer calls the helpline. The AI identifies them from the number, loads their record, and speaks with your tone, your policies and your limits.",
  },
  {
    n: "02",
    title: "It resolves, or it stops",
    body: "Answers come only from your documentation, with the source cited. Beyond its authority it doesn't improvise — it escalates.",
  },
  {
    n: "03",
    title: "A human picks it up warm",
    body: "The agent receives a written brief: the issue, what was tried, what's permitted, and the one decision left to make. No re-asking.",
  },
  {
    n: "04",
    title: "The system learns",
    body: "Every unresolved call becomes a documentation gap, a tuning suggestion and a moved score on the customer's record.",
  },
] as const;

/** The eleven scoring axes, with Aurelius Home's weights. */
export const axes = [
  { label: "Revenue / LTV", weight: "90%" },
  { label: "Churn risk", weight: "100%" },
  { label: "Sentiment from calls", weight: "75%" },
  { label: "Escalation likelihood", weight: "65%" },
  { label: "Engagement / usage", weight: "45%" },
  { label: "Payment reliability", weight: "70%" },
  { label: "Cost to serve", weight: "55%" },
  { label: "Advocacy / NPS", weight: "50%" },
  { label: "Contract tier & SLA", weight: "85%" },
  { label: "Expansion potential", weight: "40%" },
  { label: "Risk flags", weight: "30%" },
] as const;

export const axisNotes = [
  "Weights are per brand. A subscription business and a furniture retailer do not care about the same things.",
  "Every score is timestamped, so you can see the customer as they were three months ago.",
] as const;

export const platformCards = [
  {
    title: "Customer 360",
    body: "Identity, contracts, entitlements, orders, devices, every call and message, and the score history — on one scrolling record with no tabs to hunt through.",
  },
  {
    title: "Priority queue",
    body: "A queue ordered by what it costs you to ignore. Filter on any axis, save the view, share it with the team, alert on it.",
  },
  {
    title: "Knowledge that answers",
    body: "Keep policies and playbooks here. Corva tells you which documents the AI leans on, which are stale, and where the gaps are.",
  },
  {
    title: "Tuning & guardrails",
    body: "Set the persona, the refund ceiling, the forbidden promises and the escalation triggers. Test against real past calls before you ship a version.",
  },
  {
    title: "Multi-brand workspaces",
    body: "One company, many brands. Separate numbers, documentation, tone and weights — with roles that scope people to the brand they work on.",
  },
  {
    title: "Audit & residency",
    body: "Every AI action is logged with its citation. SSO, SCIM, regional storage, redaction of card and health data at capture.",
  },
  {
    title: "Analytics on the AI itself",
    body: "Containment, first-call resolution, cost per contact, and the top intents it still can't finish — ranked by what fixing them would return.",
  },
  {
    title: "Every channel, one thread",
    body: "Phone, WhatsApp, email and web chat land on the same conversation record, so the customer never repeats themselves.",
  },
  {
    title: "Open by default",
    body: "Read and write anything through the API, stream events to your warehouse, and pull records from the CRM you already run.",
  },
] as const;

export const plans = [
  {
    name: "Studio",
    price: "£0.42",
    unit: " / conversation",
    blurb: "One brand, one helpline, the full customer record. For teams under ten.",
    features: [
      "Unlimited seats & customers",
      "Knowledge base up to 200 docs",
      "Standard tuning presets",
      "90-day transcript retention",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Operator",
    price: "£0.31",
    unit: " / conversation",
    blurb: "Up to five brands, custom scoring weights, and the full tuning workbench.",
    features: [
      "Everything in Studio",
      "Custom axes & priority rules",
      "Guardrails, versions & test suites",
      "SSO, roles, audit log",
      "2-year retention",
    ],
    cta: "Book a demo",
    featured: true,
    badge: "Most brands",
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    unit: "",
    blurb: "Unlimited brands, private model tuning, regional residency, dedicated review.",
    features: [
      "Everything in Operator",
      "Private fine-tuning on your calls",
      "Data residency & BYO keys",
      "99.95% SLA, named engineer",
    ],
    cta: "Contact sales",
    featured: false,
  },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Customer 360", href: "#platform" },
      { label: "AI helpline", href: "#platform" },
      { label: "Signals", href: "#signals" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Press", href: "#" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Security", href: "#" },
      { label: "Sub-processors", href: "#" },
      { label: "DPA", href: "#" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "API", href: "#" },
      { label: "Webhooks", href: "#" },
      { label: "Status", href: "#" },
    ],
  },
] as const;
