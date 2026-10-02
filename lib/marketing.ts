/**
 * Content for the marketing site.
 *
 * The layout came from `design/Corva Landing.dc.html`; the words describe
 * what Corva is now — an AI front office on a business's website chat, voice
 * that turns every conversation into a customer record, a lead and
 * a follow-up, with an API for the business's own site and systems. Nothing
 * here claims a feature the product does not have; what is planned is in
 * docs/ROADMAP.md, not on this page.
 */

import { PLANS, amount, rupees } from "@/lib/billing/plans";

export const heroStats = [
  { label: "Website chat and voice, day or night", value: "24", suffix: "/7", suffixAccent: true },
  { label: "Conversations that become a record", value: "100", suffix: "%", suffixAccent: true },
  { label: "From your website to a working assistant", value: "5", suffix: "min", suffixAccent: false },
  { label: "Settings your site needs to connect", value: "2", suffix: "keys", suffixAccent: false },
] as const;

export const logos = ["Clinics", "Real estate", "Retail", "Coaching", "Home services", "Laundry"] as const;

/** The waveform in the console mock — heights as percentages. */
export const heroWave = [40, 70, 100, 55, 85, 30, 65, 95, 45, 75, 35, 60, 90, 50, 25, 70, 40, 80] as const;

export const knownFacts = [
  { label: "Lifetime value", value: "₹12,49,500", hot: false },
  { label: "Open leads", value: "2", hot: false },
  { label: "Follow-up due", value: "today, 4 pm", hot: true },
  { label: "Owner", value: "Kavya Rao", hot: false },
  { label: "Last spoke to us", value: "3 days ago", hot: false },
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
    body: "On your website's chat, or on a voice call started from your site. It knows a returning customer and loads their record; anyone new becomes a contact as they speak.",
  },
  {
    n: "02",
    title: "It helps, within your limits",
    body: "Answers come only from what your business told it — your website, your prices, your policies. It asks for the details you chose to collect. Beyond its authority it does not improvise.",
  },
  {
    n: "03",
    title: "Every conversation becomes work",
    body: "A booking the customer confirms on a card. A lead with an owner on your team. A follow-up with a name and a time — and the details already filled in.",
  },
  {
    n: "04",
    title: "Your team closes it",
    body: "Take any chat or call over live, with one click. Leads move through your pipeline, follow-ups get ticked off, and you can see who is winning business and keeping promises.",
  },
] as const;


/** The industries section: each template's own words for its pipeline. */
export const industryNotes = [
  "Pick an industry when a business is added. The AI already knows what to ask, what can be booked and what it may do on its own.",
  "Your pipeline uses your words — an appointment booked, a site visit fixed, a pickup booked.",
  "Then make it yours: the details it collects, what it may promise, when it hands over.",
] as const;


export const platformCards = [
  {
    title: "An AI on chat and voice",
    body: "One assistant on your website's chat and on voice calls from your site. Same knowledge, same limits, same record afterwards.",
  },
  {
    title: "Answers only from your business",
    body: "It reads your website and what you tell it, and answers from that alone — with the source on record. What it does not know, it says, and offers a callback.",
  },
  {
    title: "Details you choose to collect",
    body: "Address, request type, budget — your list, your order, your required fields. The AI asks naturally and your team sees them filled in.",
  },
  {
    title: "Bookings the customer confirms",
    body: "The AI gathers the details and shows a card. Nothing is booked until the customer taps Confirm — then the lead, the owner and the email all happen.",
  },
  {
    title: "Leads and follow-ups",
    body: "Anyone who wants something becomes a lead with an owner. Every promised callback lands with a person and a time; overdue ones come first each morning.",
  },
  {
    title: "Take over, live",
    body: "Watch any chat or call as it happens. One click and the AI tells the customer it is passing them to you — then you type, or talk, from the console.",
  },
  {
    title: "One record per customer",
    body: "Every chat and call, their leads and follow-ups, how they found you, notes and consent — on one page, whoever picks it up.",
  },
  {
    title: "Team performance",
    body: "Leads owned and won, follow-ups done on time, handoffs picked up — per person, without a made-up combined score.",
  },
  {
    title: "Limits you set",
    body: "What the AI may refund, waive or book on its own, what it must never say, and when it hands over — changed in minutes, logged every time.",
  },
  {
    title: "Two settings to connect",
    body: "Your website's server gets an address and a key. The chat window stays yours; the assistant, the bookings and the emails are ours.",
  },
  {
    title: "Your systems, kept in step",
    body: "Signed webhooks tell your CRM or order system the moment there is a new lead, a follow-up or a handoff. A documented API covers the rest.",
  },
  {
    title: "Set up from your website",
    body: "Give Corva your web address. It reads your services, prices and policies and the AI can take customers the same afternoon.",
  },
] as const;

/** The ways a business connects. All three reach the same assistant and the same console. */
export const connectWays = [
  {
    n: "A",
    title: "Chat on your website",
    body: "Your chat window, Corva's assistant behind it — with booking cards your customer confirms. Your developer needs an afternoon and two settings.",
    link: { label: "Developer docs", href: "/developers" },
  },
  {
    n: "B",
    title: "Voice on your website",
    body: "A call button on your site: customers talk to the assistant from their browser, and your team can take the call over and speak to them.",
    link: { label: "How voice works", href: "/developers#voice" },
  },
  {
    n: "C",
    title: "Behind what you already have",
    body: "Keep your own forms or chatbot. Send Corva the bookings and transcripts, and get owners, follow-ups and emails back — with webhooks to your systems.",
    link: { label: "API reference", href: "/developers#reference" },
  },
] as const;


/**
 * The plans, as the public site shows them. Prices and included usage come
 * from lib/billing/plans.ts — the same figures Billing charges and the product
 * enforces — so this page cannot quote something else.
 */
const { starter, growth } = PLANS;
const history = (days: number) => (days >= 365 ? `${Math.round(days / 365)}-year history` : `${days}-day history`);

export const plans = [
  {
    name: starter.name,
    price: rupees(starter.priceRupees!),
    unit: " / month",
    blurb: "One business with a small team. Everything needed to answer, book and follow up.",
    features: [
      `${amount(starter.chats)} AI chats + ${amount(starter.voiceMinutes)} voice minutes`,
      "Website chat and voice",
      "Leads, follow-ups, customer records",
      "Details to collect, bookings by card",
      "API and webhooks",
      `${starter.members} team members · ${history(starter.historyDays)}`,
    ],
    cta: "Start free for 14 days",
    href: "/sign-up",
    featured: false,
  },
  {
    name: growth.name,
    price: rupees(growth.priceRupees!),
    unit: " / month",
    blurb: "Several brands or branches, a bigger team, and the numbers to manage it.",
    features: [
      `${amount(growth.chats)} AI chats + ${amount(growth.voiceMinutes)} voice minutes`,
      "Everything in Starter",
      `Up to ${growth.brands} brands`,
      "Team performance and the audit log",
      `${growth.members} team members · ${history(growth.historyDays)}`,
    ],
    cta: "Start free for 14 days",
    href: "/sign-up",
    featured: true,
    badge: "Most businesses",
  },
  {
    name: "Business",
    price: "Talk to us",
    unit: "",
    blurb: "Many branches, a larger team, and help moving over from what you use today.",
    features: [
      "Usage and team sized to you",
      "Many brands or branches",
      "Custom industry setup",
      "An SLA",
      "A named person at Corva",
    ],
    cta: "Book a demo",
    href: "/demo",
    featured: false,
  },
] as const;

export const planNotes = [
  "A chat is one conversation, however many messages. A voice minute is a minute on a call.",
  `Beyond what is included: ${rupees(starter.overage!.chat)} a chat and ${rupees(starter.overage!.voiceMinute)} a voice minute on Starter; ${rupees(growth.overage!.chat)} and ${rupees(growth.overage!.voiceMinute)} on Growth — the assistant never stops mid-month.`,
  `Every business starts with a free ${PLANS.pilot.periodDays}-day pilot: ${PLANS.pilot.chats} chats and ${PLANS.pilot.voiceMinutes} voice minutes, no card. Prices exclude GST.`,
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "AI assistant", href: "/#platform" },
      { label: "How it works", href: "/#loop" },
      { label: "Ways to connect", href: "/#connect" },
      { label: "Industries", href: "/#signals" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "API docs", href: "/developers" },
      { label: "Webhooks", href: "/developers#webhooks" },
      { label: "OpenAPI spec", href: "/api/v1/openapi.json" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Start free", href: "/sign-up" },
      { label: "Book a demo", href: "/demo" },
      { label: "Sign in", href: "/app" },
    ],
  },
] as const;
