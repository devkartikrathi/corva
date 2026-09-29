/**
 * Content for the marketing site.
 *
 * The layout came from `design/Corva Landing.dc.html`; the words describe
 * what Corva is now — an AI front office that answers the phone and turns
 * every call into a customer record, a lead and a follow-up. Nothing here
 * claims a feature the product does not have.
 */

export const heroStats = [
  { label: "Calls answered, day or night", value: "24", suffix: "/7", suffixAccent: true },
  { label: "Callers who become a record", value: "100", suffix: "%", suffixAccent: true },
  { label: "From website to answering calls", value: "5", suffix: "min", suffixAccent: false },
  { label: "Callbacks with a name and a time", value: "100", suffix: "%", suffixAccent: true },
] as const;

export const logos = ["Clinics", "Real estate", "Retail", "Coaching", "Home services"] as const;

/** The waveform in the console mock — heights as percentages. */
export const heroWave = [40, 70, 100, 55, 85, 30, 65, 95, 45, 75, 35, 60, 90, 50, 25, 70, 40, 80] as const;

export const knownFacts = [
  { label: "Lifetime value", value: "₹12,49,500", hot: false },
  { label: "Open orders", value: "2", hot: false },
  { label: "Reschedules", value: "3 this month", hot: true },
  { label: "Last NPS", value: "4 · detractor", hot: false },
  { label: "Contract renews", value: "18 Oct", hot: false },
] as const;

export const nextActions = [
  { label: "Waive install fee (₹7,500)", state: "Needs Manager", hot: true },
  { label: "Fixed AM slot · Thu", state: "Auto-approved", hot: false },
  { label: "Flag account for retention", state: "1 click", hot: false },
] as const;

export const loopSteps = [
  {
    n: "01",
    title: "The AI answers",
    body: "Someone rings your number. The AI knows a returning customer by their number and loads their record; anyone new becomes a contact the moment they call.",
  },
  {
    n: "02",
    title: "It helps, within your limits",
    body: "Answers come only from what your business told it — your website, your prices, your policies. Beyond its authority it does not improvise: it hands over with a written brief.",
  },
  {
    n: "03",
    title: "Every call becomes work",
    body: "What the caller wants is saved as a lead with an owner on your team. Every \u201cwe'll call you back\u201d is a follow-up with a name and a time.",
  },
  {
    n: "04",
    title: "Your team closes it",
    body: "Leads move through your pipeline, follow-ups get ticked off, and you can see who is winning business and who is keeping their promises.",
  },
] as const;

/** The industries section: each template's own words for its pipeline. */
export const industryNotes = [
  "Pick an industry when you add a business. The AI already knows what to ask a new caller and what it may do on its own.",
  "Your pipeline uses your words — an appointment booked, a site visit fixed, a demo class attended.",
] as const;

export const platformCards = [
  {
    title: "An AI that answers the phone",
    body: "Speaks with your tone, knows returning customers by their number, and answers only from what your business told it — with the source on record.",
  },
  {
    title: "Leads, captured on the call",
    body: "A new caller who wants something becomes a lead with an owner before they hang up. Your pipeline, in your industry's own stage names.",
  },
  {
    title: "Follow-ups that happen",
    body: "Every promised callback lands with a person and a time. Overdue ones are the first thing anyone sees in the morning.",
  },
  {
    title: "One record per customer",
    body: "Every call and chat, their leads and follow-ups, notes and consent — on one page, whoever on the team picks it up.",
  },
  {
    title: "Take the line any time",
    body: "Watch a call live, with what the AI has recorded so far. Press one button and it goes quiet while you talk.",
  },
  {
    title: "Handoffs with a brief",
    body: "When the AI reaches a limit it writes up the call and rings the right person — whoever owns the account, or whoever is free.",
  },
  {
    title: "Team performance",
    body: "Leads owned and won, follow-ups done on time, handoffs picked up — per person, without a made-up combined score.",
  },
  {
    title: "Set up from your website",
    body: "Give Corva your web address. It reads your services, prices and policies and the AI can take calls the same afternoon.",
  },
  {
    title: "Limits you set",
    body: "What the AI may refund, waive or book on its own, what it must never say, and when it hands over — changed in minutes, logged every time.",
  },
] as const;

export const plans = [
  {
    name: "Starter",
    price: "₹36",
    unit: " / conversation",
    blurb: "One business, one number, the full customer record. For teams under ten.",
    features: [
      "AI on phone and web chat",
      "Leads & follow-ups",
      "Knowledge from your website",
      "90-day transcript retention",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Growth",
    price: "₹27",
    unit: " / conversation",
    blurb: "Several brands or branches, a bigger team, and the numbers to manage it.",
    features: [
      "Everything in Starter",
      "Up to five brands",
      "Team performance",
      "Roles, audit log",
      "2-year retention",
    ],
    cta: "Book a demo",
    featured: true,
    badge: "Most businesses",
  },
  {
    name: "Business",
    price: "Talk to us",
    unit: "",
    blurb: "Many branches, your own phone lines, and help moving over from what you use today.",
    features: [
      "Everything in Growth",
      "Your existing numbers",
      "Custom industry setup",
      "A named person at Corva",
    ],
    cta: "Contact us",
    featured: false,
  },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "AI phone assistant", href: "#platform" },
      { label: "Leads & follow-ups", href: "#platform" },
      { label: "Industries", href: "#signals" },
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
