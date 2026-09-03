/**
 * Every fixture behind the Corva console, ported from the source design
 * (`design/Corva App.dc.html`). Derived presentation values — bar widths,
 * accent thresholds, tag colours — are computed here exactly as the design
 * computed them, so a screen never re-derives them inline.
 */
import { config } from "./config";

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
const N_400 = "var(--color-neutral-400)";
const N_500 = "var(--color-neutral-500)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";
const TEXT = "var(--color-text)";

const pct = (n: number) => `${n}%`;

/** Accent when the score clears the configured threshold, ink otherwise. */
const scoreColor = (n: number) =>
  n >= config.accentPriorityThreshold ? ACCENT : N_700;

/* ─── Command center ───────────────────────────────────────────────────── */

export const headlineStats = [
  { label: "AI containment", value: "71.4", unit: "%", note: "vs last week", delta: "+3.1" },
  { label: "Handoffs waiting", value: "7", note: "Oldest", strong: "6m 12s" },
  { label: "At-risk revenue", value: "£412k", note: "Across", strong: "38", noteAfter: "accounts" },
  { label: "Avg sentiment", value: "+0.21", note: "since Monday", delta: "−0.05" },
  { label: "Cost per contact", value: "£0.68", note: "Human baseline", strong: "£4.90" },
] as const;

export const liveCalls = [
  {
    name: "M. Okonkwo",
    priority: "P92",
    hot: true,
    elapsed: "04:12",
    intent: "Delivery reschedule → cancellation threat",
    sentimentBar: "34%",
    sentiment: "−0.32",
    negative: true,
  },
  {
    name: "T. Vasquez",
    priority: "P54",
    hot: false,
    elapsed: "01:48",
    intent: "Warranty claim, sofa frame",
    sentimentBar: "68%",
    sentiment: "+0.36",
    negative: false,
    footNote: "On track · citing",
    footStrong: "Warranty terms §7",
  },
  {
    name: "Halvard Bruun",
    priority: "P31",
    hot: false,
    elapsed: "00:22",
    intent: "Invoice copy request",
    sentimentBar: "82%",
    sentiment: "+0.64",
    negative: false,
    footNote: "Likely self-resolve ·",
    footStrong: "94%",
  },
] as const;

export const queue = [
  { name: "Marguerite Okonkwo", meta: "Retail · Tier 1 · since 2019", priority: 92, why: "3 reschedules · cancellation intent on live call", value: "£14,280", action: "Call now", hot: true },
  { name: "Pemberton Interiors", meta: "Trade · 14 seats · Manchester", priority: 88, why: "Invoice dispute £8,410 · renewal in 21 days", value: "£96,500", action: "Finance review", hot: true },
  { name: "Sofia Lindqvist", meta: "Retail · Tier 2 · Stockholm", priority: 76, why: "Asked for a human 3× · sentiment −0.41", value: "£3,940", action: "Assign agent", hot: true },
  { name: "Casa Verde Ltd", meta: "Trade · 6 seats · Lisbon", priority: 64, why: "Usage up 40% · no account owner assigned", value: "£41,200", action: "Expansion", hot: false },
  { name: "Halvard Bruun", meta: "Retail · Tier 1 · Oslo", priority: 58, why: "NPS 4 after resolved claim · advocate lost", value: "£9,110", action: "Win-back", hot: false },
  { name: "Odile Marchetti", meta: "Retail · Tier 3 · Lyon", priority: 41, why: "Two failed payments · card expiring", value: "£1,260", action: "Payment nudge", hot: false },
].map((r) => ({
  ...r,
  pBar: pct(r.priority),
  pColor: scoreColor(r.priority),
  actionBg: r.hot ? ACCENT_200 : N_200,
  actionFg: r.hot ? ACCENT_800 : N_800,
}));

/** Hourly contact volume, 08:00 → 21:00. Each pair is [AI, human]. */
export const volume = (
  [[18, 10], [26, 12], [34, 14], [41, 16], [52, 18], [48, 22], [38, 14], [44, 18], [57, 20], [62, 16], [49, 15], [36, 12], [24, 9], [15, 6]] as const
).map(([ai, human]) => ({ ai: pct(ai * 1.2), human: pct(human * 1.2) }));

export const needsHuman = [
  { name: "Marguerite Okonkwo", wait: "waiting 6m", urgent: true, note: "Wants install fee waived beyond AI authority. Brief ready." },
  { name: "Pemberton Interiors", wait: "waiting 4m", urgent: true, note: "Trade account, disputed invoice £8,410. Finance approval needed." },
  { name: "Sofia Lindqvist", wait: "waiting 2m", urgent: false, note: "Asked for a human three times. Sentiment falling." },
] as const;

export const docGaps = [
  { count: "14×", hot: true, text: "No policy for part-delivery refunds", cta: "Draft" },
  { count: "9×", hot: true, text: "Assembly service area not defined", cta: "Draft" },
  { count: "6×", hot: false, text: "Trade discount tiers out of date", cta: "Update" },
  { count: "4×", hot: false, text: "Fabric care after 24 months unclear", cta: "Draft" },
] as const;

export const scoreMovers = [
  { name: "Okonkwo, M.", axis: "churn risk", delta: "+28", hot: true },
  { name: "Pemberton Int.", axis: "payment", delta: "+19", hot: true },
  { name: "Bruun, H.", axis: "advocacy", delta: "−12", hot: false },
  { name: "Casa Verde Ltd", axis: "expansion", delta: "+9", hot: false },
] as const;

/* ─── All customers ────────────────────────────────────────────────────── */

export const axisFilters = [
  { label: "Priority score", readout: "≥ 60", bar: "60%", color: ACCENT },
  { label: "Churn risk", readout: "≥ 45", bar: "45%", color: ACCENT },
  { label: "Revenue / LTV", readout: "≥ £5,000", bar: "38%", color: N_700 },
  { label: "Escalation likelihood", readout: "any", bar: "0%", color: N_700 },
  { label: "Cost to serve", readout: "≥ 70", bar: "70%", color: N_700 },
  { label: "Advocacy / NPS", readout: "any", bar: "0%", color: N_700 },
] as const;

const HOT_FLAGS = ["On call", "Dispute", "Wants human", "Payment", "Detractor"];

export const customers = [
  { name: "Marguerite Okonkwo", meta: "Retail · Tier 1 · London", priority: 92, ltv: "£14,280", churn: "84 · high", churnV: 84, sentiment: "−0.32", last: "on call now", owner: "Unassigned", flag: "On call" },
  { name: "Pemberton Interiors", meta: "Trade · 14 seats · Manchester", priority: 88, ltv: "£96,500", churn: "71 · high", churnV: 71, sentiment: "−0.18", last: "12 min ago", owner: "J. Okafor", flag: "Dispute" },
  { name: "Sofia Lindqvist", meta: "Retail · Tier 2 · Stockholm", priority: 76, ltv: "£3,940", churn: "66 · high", churnV: 66, sentiment: "−0.41", last: "24 min ago", owner: "Unassigned", flag: "Wants human" },
  { name: "Casa Verde Ltd", meta: "Trade · 6 seats · Lisbon", priority: 64, ltv: "£41,200", churn: "22 · low", churnV: 22, sentiment: "+0.44", last: "2 days ago", owner: "Unassigned", flag: "Expansion" },
  { name: "Halvard Bruun", meta: "Retail · Tier 1 · Oslo", priority: 58, ltv: "£9,110", churn: "39 · medium", churnV: 39, sentiment: "+0.12", last: "1 hour ago", owner: "R. Mehta", flag: "Detractor" },
  { name: "Odile Marchetti", meta: "Retail · Tier 3 · Lyon", priority: 41, ltv: "£1,260", churn: "58 · medium", churnV: 58, sentiment: "+0.05", last: "5 days ago", owner: "R. Mehta", flag: "Payment" },
  { name: "Thandiwe Vasquez", meta: "Retail · Tier 2 · Bristol", priority: 39, ltv: "£6,730", churn: "31 · low", churnV: 31, sentiment: "+0.36", last: "on call now", owner: "AI only", flag: "On call" },
  { name: "Northmoor Estates", meta: "Trade · 31 seats · Leeds", priority: 34, ltv: "£188,400", churn: "18 · low", churnV: 18, sentiment: "+0.58", last: "8 days ago", owner: "J. Okafor", flag: "Key account" },
  { name: "Ines Ferreira", meta: "Retail · Tier 2 · Porto", priority: 28, ltv: "£2,480", churn: "26 · low", churnV: 26, sentiment: "+0.62", last: "3 days ago", owner: "AI only", flag: "Healthy" },
  { name: "Kessel & Co", meta: "Trade · 9 seats · Hamburg", priority: 24, ltv: "£54,900", churn: "14 · low", churnV: 14, sentiment: "+0.71", last: "11 days ago", owner: "A. Lindberg", flag: "Advocate" },
  { name: "Bartholomew Nkemdirim", meta: "Retail · Tier 1 · Dublin", priority: 19, ltv: "£11,900", churn: "12 · low", churnV: 12, sentiment: "+0.66", last: "16 days ago", owner: "AI only", flag: "Silent VIP" },
  { name: "Rowan Ashby-Hale", meta: "Retail · Tier 3 · Cardiff", priority: 11, ltv: "£640", churn: "9 · low", churnV: 9, sentiment: "+0.49", last: "27 days ago", owner: "AI only", flag: "Healthy" },
].map((c) => {
  const hot = HOT_FLAGS.includes(c.flag);
  const negative = c.sentiment.startsWith("−");
  return {
    ...c,
    pColor: scoreColor(c.priority),
    churnBar: pct(c.churnV),
    churnColor: c.churnV >= 60 ? ACCENT : N_500,
    sentColor: negative ? ACCENT_700 : N_800,
    flagBg: hot ? ACCENT_200 : N_200,
    flagFg: hot ? ACCENT_800 : N_800,
  };
});

export const customerViews = [
  { label: "High priority · 38", current: true },
  { label: "All · 24,318", current: false },
  { label: "Churn watch · 214", current: false },
  { label: "Trade accounts · 906", current: false },
  { label: "Silent VIPs · 47", current: false },
  { label: "Payment risk · 68", current: false },
] as const;

export const behaviourFlags = [
  { label: "Contacted 3+ times this month", on: true },
  { label: "Unresolved by AI", on: true },
  { label: "Renewal in 60 days", on: false },
  { label: "Fraud / abuse flag", on: false },
  { label: "No owner assigned", on: false },
] as const;

/* ─── Customer 360 ─────────────────────────────────────────────────────── */

export const scoreBreakdown = [
  { axis: "Churn risk 84 × weight 1.0", contribution: "+31", hot: true, why: "3 reschedules, cancellation language on today's call" },
  { axis: "Sentiment −0.32 × weight 0.75", contribution: "+18", hot: true, why: "Falling across the last three contacts" },
  { axis: "LTV £14,280 × weight 0.9", contribution: "+21", hot: true, why: "Top 8% of retail customers" },
  { axis: "Advocacy NPS 4 × weight 0.5", contribution: "+8", hot: false, why: "Detractor since June" },
] as const;

export const scoreRule = {
  axis: 'Rule · "Tier 1 + cancellation intent"',
  contribution: "+14",
  why: "Written by D. Rahman · 12 Aug",
} as const;

export const signals = [
  { label: "Revenue / LTV", value: "92", v: 92, medianV: 61, delta: "+31" },
  { label: "Churn risk", value: "84", v: 84, medianV: 34, delta: "+50" },
  { label: "Sentiment from calls", value: "−0.32", v: 34, medianV: 62, delta: "−0.9" },
  { label: "Escalation likelihood", value: "77", v: 77, medianV: 28, delta: "+49" },
  { label: "Engagement / usage", value: "48", v: 48, medianV: 55, delta: "−7" },
  { label: "Payment reliability", value: "96", v: 96, medianV: 88, delta: "+8" },
  { label: "Cost to serve", value: "71", v: 71, medianV: 42, delta: "+29" },
  { label: "Advocacy / NPS", value: "4", v: 22, medianV: 68, delta: "−46" },
  { label: "Contract tier & SLA", value: "Premier", v: 90, medianV: 50, delta: "top" },
  { label: "Expansion potential", value: "61", v: 61, medianV: 44, delta: "+17" },
  { label: "Risk flags", value: "none", v: 4, medianV: 8, delta: "clear" },
].map((s) => ({
  ...s,
  bar: pct(s.v),
  median: pct(s.medianV),
  // Payment reliability scores high but is good news — never flagged accent.
  color: s.v >= 70 && s.label !== "Payment reliability" ? ACCENT : N_700,
}));

export const timeline = [
  { date: "3 Sep", time: "14:22", channel: "Phone · AI", title: "Delivery moved a third time", outcome: "Escalated", summary: "Offered £40 goodwill credit and a fixed Thursday morning slot. Customer demanded the £85 install fee waived and threatened to cancel. Beyond AI authority — routed to a human with brief.", handled: "AI → waiting", duration: "04:12", sentiment: "−0.32", cited: "Service promise v4 §3.2", hot: true },
  { date: "28 Aug", time: "09:41", channel: "WhatsApp · AI", title: "Where is my order?", outcome: "Resolved", summary: "Gave live courier ETA and rebooked to the 2 Sep slot at the customer's request.", handled: "AI only", duration: "02:06", sentiment: "+0.11", cited: "Order tracking playbook", hot: false },
  { date: "14 Aug", time: "16:03", channel: "Phone · Human", title: "Second reschedule complaint", outcome: "Resolved", summary: "R. Mehta apologised, issued £25 credit, promised a fixed slot. Promise not recorded on the order — root cause of today's call.", handled: "R. Mehta", duration: "11:38", sentiment: "−0.08", cited: "No document cited", hot: false },
  { date: "2 Aug", time: "11:15", channel: "Email · AI", title: "Fabric care question", outcome: "Resolved", summary: "Answered from the care guide and attached the PDF for the Lindholm range.", handled: "AI only", duration: "—", sentiment: "+0.42", cited: "Care guide · Lindholm", hot: false },
  { date: "19 Jun", time: "13:52", channel: "Survey", title: "NPS response", outcome: "Detractor", summary: "Scored 4. Free text: delivery reliability, praised the product itself.", handled: "—", duration: "—", sentiment: "−0.20", cited: "—", hot: true },
  { date: "07 Mar", time: "10:30", channel: "Phone · Human", title: "Kitchen renovation enquiry", outcome: "No follow-up", summary: "Asked about the fitted range. Quote never sent. Flagged by the AI as a missed expansion signal worth roughly £6,000.", handled: "A. Lindberg", duration: "07:14", sentiment: "+0.61", cited: "—", hot: false },
].map((ev) => {
  const flagged = ev.hot || ev.outcome === "Escalated";
  return {
    ...ev,
    chColor: ev.channel.includes("AI") ? ACCENT_700 : N_700,
    tagBg: flagged ? ACCENT_200 : N_200,
    tagFg: flagged ? ACCENT_800 : N_800,
  };
});

export const commercialRecord = [
  { label: "Lifetime value", value: "£14,280", note: "9 orders · avg £1,586", hot: false },
  { label: "Open orders", value: "2", note: "AH-40912 delayed 3×", hot: true },
  { label: "Cost to serve", value: "£186", note: "1.3% of LTV · 11 contacts", hot: false },
  { label: "Service promise", value: "Premier", note: "Goodwill ceiling £50 · 4h SLA", hot: false },
] as const;

export const aiLearned = [
  "Prefers morning delivery slots; two evening bookings were both missed.",
  'Responds badly to being transferred — asked for "one person who owns this" twice.',
  "Works from home Tuesdays and Thursdays.",
  "Mentioned a kitchen renovation in March — expansion signal, never followed up.",
] as const;

export const linkedRecords = [
  { name: "Ade Okonkwo", note: "same address" },
  { name: "Okonkwo Studio", note: "trade account" },
] as const;

export const consent = [
  { label: "Call recording", value: "Consented · Mar 2019" },
  { label: "Marketing", value: "Opted out" },
  { label: "Data region", value: "EU / London" },
  { label: "Card data", value: "Redacted at capture" },
] as const;

/* ─── Live call console ────────────────────────────────────────────────── */

const WAVE = [30, 55, 80, 45, 95, 25, 60, 90, 40, 70, 35, 60, 88, 50, 22, 68, 42, 78, 58, 34, 92, 46, 64, 30, 74, 52, 86, 38, 60, 28, 70, 48, 82, 36, 56, 26, 66, 44, 76, 32];
export const wave = WAVE.map((h) => ({ h: pct(h), color: h > 72 ? ACCENT : N_400 }));

const SENTIMENT_POINTS = [62, 64, 60, 58, 55, 52, 48, 46, 44, 40, 52, 50, 44, 38, 34, 32];
export const sentCurve = SENTIMENT_POINTS.map((v) => ({ h: pct(v), color: v < 45 ? ACCENT : N_500 }));

export const transcript = [
  { label: "03:41 Cust", who: N_500, textColor: TEXT, text: "Hello — I'm calling about my sofa order, AH-40912.", hasCite: false },
  { label: "03:44 AI", who: ACCENT_700, textColor: TEXT, text: "I have it in front of me, Marguerite. It's the Lindholm three-seater, currently scheduled for Friday the 5th. I can see it's been moved twice before that.", hasCite: true, cite: "Order record · AH-40912", check: "Identity verified by number" },
  { label: "04:02 Cust", who: N_500, textColor: TEXT, text: "This is the third time the delivery slot has moved. I've taken a day off work for this.", hasCite: false },
  { label: "04:06 AI", who: ACCENT_700, textColor: TEXT, text: "You've had three reschedules, so this qualifies for the goodwill credit under your service promise. I can apply £40 now and book a fixed morning slot for Thursday — you won't be given a window this time.", hasCite: true, cite: "Cited · Service promise v4 §3.2", check: "Goodwill ceiling £50 · within policy" },
  { label: "04:09 Cust", who: N_500, textColor: TEXT, text: "Fine. But this has cost me two days now.", hasCite: false },
  { label: "04:11 Cust", who: N_500, textColor: TEXT, text: "And I want the installation fee waived. Otherwise I'm cancelling the whole contract.", hasCite: false },
  { label: "04:12 AI", who: ACCENT_700, textColor: TEXT, text: "That's a decision for a manager, and I'd rather not guess at it. I'm getting one now — you'll keep the credit and the slot either way.", hasCite: true, cite: "Fee schedule 2026 · waiver = Manager", check: "Refused to exceed authority" },
] as const;

export const callerFacts = [
  { label: "Lifetime value", value: "£14,280", hot: false },
  { label: "Churn risk", value: "84 · high", hot: true },
  { label: "Contacts this month", value: "4", hot: false },
  { label: "Last agent", value: "R. Mehta", hot: false },
  { label: "Renews", value: "18 Oct", hot: false },
] as const;

export const openOrders = [
  { id: "AH-40912", line: "Lindholm 3-seater · £1,840", status: "Rescheduled 3× · now 5 Sep", urgent: true },
  { id: "AH-41307", line: "Side table · £220", status: "In transit · 4 Sep", urgent: false },
] as const;

export const entitlements = [
  { label: "Goodwill credit", value: "up to £50", blocked: false },
  { label: "Reschedule", value: "unlimited", blocked: false },
  { label: "Fee waiver", value: "manager only", blocked: true },
  { label: "Full refund", value: "blocked", blocked: true },
  { label: "Contract change", value: "blocked", blocked: true },
] as const;

export const documentsInPlay = [
  { title: "Service promise v4", confidence: "98%", strong: true, note: "§3.2 goodwill on repeat delay" },
  { title: "Delivery ops playbook", confidence: "74%", strong: false, note: "Fixed-slot booking rules" },
  { title: "Fee schedule 2026", confidence: "61%", strong: false, note: "Install fee £85 · waiver needs Manager" },
] as const;

export const callActions = [
  { at: "04:06", text: "£40 goodwill credit applied", hot: false },
  { at: "04:07", text: "Thu AM slot provisionally held", hot: false },
  { at: "04:11", text: "Escalation raised · handoff queued", hot: true },
] as const;

/* ─── Handoffs ─────────────────────────────────────────────────────────── */

export const handoffs = [
  { name: "Marguerite Okonkwo", wait: "6m 12s", reason: "Install fee waiver beyond AI authority · cancellation intent", channel: "Phone · live", priority: 92, value: "£14,280", active: true, urgent: true },
  { name: "Pemberton Interiors", wait: "4m 03s", reason: "Disputed invoice £8,410 · needs finance approval", channel: "Phone · live", priority: 88, value: "£96,500", active: false, urgent: true },
  { name: "Sofia Lindqvist", wait: "2m 41s", reason: "Asked for a human three times · sentiment falling", channel: "Web chat", priority: 76, value: "£3,940", active: false, urgent: true },
  { name: "Casa Verde Ltd", wait: "8m 55s", reason: "Trade pricing question with no matching document", channel: "Email", priority: 64, value: "£41,200", active: false, urgent: false },
  { name: "Halvard Bruun", wait: "11m", reason: "Wants written confirmation of a verbal promise", channel: "WhatsApp", priority: 58, value: "£9,110", active: false, urgent: false },
  { name: "Odile Marchetti", wait: "14m", reason: "Card declined twice · asked to speak to accounts", channel: "Phone · queued", priority: 41, value: "£1,260", active: false, urgent: false },
  { name: "Rowan Ashby-Hale", wait: "22m", reason: "Complaint about a previous agent — policy requires a human", channel: "Email", priority: 11, value: "£640", active: false, urgent: false },
].map((h) => ({
  ...h,
  edge: h.urgent ? ACCENT : N_400,
  bg: h.active ? "var(--color-surface)" : "transparent",
  waitColor: h.urgent ? ACCENT_700 : N_700,
  tagBg: h.channel.includes("live") ? ACCENT_200 : N_200,
  tagFg: h.channel.includes("live") ? ACCENT_800 : N_800,
}));

export const briefDidAlready = [
  { ok: true, text: "Applied £40 goodwill credit under Service promise v4 §3.2" },
  { ok: true, text: "Held a fixed Thursday 08:00–12:00 slot (not yet confirmed to her)" },
  { ok: true, text: "Verified identity by number and confirmed the delivery address" },
  { ok: false, text: "Did not discuss the fee — outside its authority, and it said so plainly" },
] as const;

export const briefTranscript = [
  { label: "04:02 Cust", ai: false, text: "This is the third time the delivery slot has moved. I've taken a day off work for this." },
  { label: "04:06 AI", ai: true, text: "You've had three reschedules on AH-40912, so this qualifies for the goodwill credit under your service promise. I can apply £40 now and book a fixed morning slot for Thursday." },
  { label: "04:11 Cust", ai: false, text: "And I want the installation fee waived. Otherwise I'm cancelling the whole contract." },
  { label: "04:12 AI", ai: true, text: "That's a decision for a manager, and I'd rather not guess at it. I'm getting one now — you'll keep the credit and the slot either way." },
] as const;

/* ─── Conversations ────────────────────────────────────────────────────── */

export const convos = [
  { name: "Sofia Lindqvist", when: "28 Aug", intent: "Part-delivery refund request", outcome: "Human resolved", channel: "WhatsApp → Phone", duration: "14m 22s", sentiment: "−0.41 → +0.28", active: true, bad: true },
  { name: "Marguerite Okonkwo", when: "3 Sep", intent: "Third delivery reschedule", outcome: "Escalated", channel: "Phone", duration: "live", sentiment: "−0.32", active: false, bad: true },
  { name: "Pemberton Interiors", when: "3 Sep", intent: "Invoice dispute £8,410", outcome: "Escalated", channel: "Phone", duration: "09m 41s", sentiment: "−0.18", active: false, bad: true },
  { name: "Halvard Bruun", when: "2 Sep", intent: "Warranty claim, sofa frame", outcome: "AI resolved", channel: "Phone", duration: "06m 12s", sentiment: "+0.36", active: false, bad: false },
  { name: "Casa Verde Ltd", when: "1 Sep", intent: "Trade pricing for 12 units", outcome: "No document", channel: "Email", duration: "—", sentiment: "+0.04", active: false, bad: true },
  { name: "Ines Ferreira", when: "1 Sep", intent: "Change delivery address", outcome: "AI resolved", channel: "Web chat", duration: "02m 08s", sentiment: "+0.62", active: false, bad: false },
  { name: "Kessel & Co", when: "31 Aug", intent: "Bulk order lead time", outcome: "AI resolved", channel: "Phone", duration: "04m 55s", sentiment: "+0.71", active: false, bad: false },
  { name: "Odile Marchetti", when: "30 Aug", intent: "Failed payment, card expired", outcome: "AI resolved", channel: "WhatsApp", duration: "01m 44s", sentiment: "+0.15", active: false, bad: false },
].map((c) => ({
  ...c,
  edge: c.bad ? ACCENT : N_400,
  bg: c.active ? "var(--color-surface)" : "transparent",
  tagBg: c.bad ? ACCENT_200 : N_200,
  tagFg: c.bad ? ACCENT_800 : N_800,
  sentColor: c.sentiment.startsWith("−") ? ACCENT_700 : N_800,
}));

export const convoSummary = [
  { label: "Outcome", value: "Resolved by human", hot: false },
  { label: "Why AI stopped", value: "No matching document", hot: true },
  { label: "Sentiment", value: "−0.41 → +0.28", hot: false },
  { label: "Quality review", value: "4 / 5 · D. Rahman", hot: false },
] as const;

/* ─── Knowledge base ───────────────────────────────────────────────────── */

export const kbTree = [
  { name: "Service promises", count: 12, on: true },
  { name: "Delivery & logistics", count: 31, on: false },
  { name: "Warranty & repairs", count: 24, on: false },
  { name: "Payments & billing", count: 19, on: false },
  { name: "Trade accounts", count: 22, on: false },
  { name: "Products & care", count: 48, on: false },
  { name: "Tone & phrasing", count: 6, on: false },
  { name: "Archived", count: 22, on: false },
].map((k) => ({ ...k, edge: k.on ? ACCENT : "transparent" }));

export const kbDocs = [
  { title: "Service promise v4", meta: "Policy · 4 pages · cited 1,204 times", uses: "312", success: "94%", v: 94, fresh: "6 days", stale: false, owner: "D. Rahman" },
  { title: "Delivery ops playbook", meta: "Playbook · 11 pages", uses: "208", success: "88%", v: 88, fresh: "3 weeks", stale: false, owner: "Ops team" },
  { title: "Fee schedule 2026", meta: "Reference · 2 pages", uses: "141", success: "71%", v: 71, fresh: "2 months", stale: false, owner: "Finance" },
  { title: "Warranty terms", meta: "Policy · 7 pages", uses: "126", success: "91%", v: 91, fresh: "5 weeks", stale: false, owner: "Legal" },
  { title: "Refunds & goodwill", meta: "Policy · 3 pages · 1 contradiction", uses: "98", success: "64%", v: 64, fresh: "9 months", stale: true, owner: "D. Rahman" },
  { title: "Trade discount tiers", meta: "Reference · 1 page · conflicts with fee schedule", uses: "74", success: "52%", v: 52, fresh: "14 months", stale: true, owner: "Unassigned" },
  { title: "Care guide · Lindholm", meta: "Product · 6 pages", uses: "61", success: "96%", v: 96, fresh: "2 weeks", stale: false, owner: "Product" },
  { title: "Escalation matrix", meta: "Playbook · 2 pages", uses: "44", success: "89%", v: 89, fresh: "8 days", stale: false, owner: "D. Rahman" },
  { title: "Tone of voice", meta: "Guide · 3 pages · shapes every reply", uses: "all", success: "—", v: 100, fresh: "4 months", stale: false, owner: "Brand" },
  { title: "Assembly service area", meta: "Missing · 9 unanswered calls", uses: "0", success: "0%", v: 0, fresh: "never", stale: true, owner: "Unassigned" },
].map((d) => ({
  ...d,
  bar: pct(d.v),
  color: d.v >= 80 ? N_700 : ACCENT,
  freshColor: d.stale ? ACCENT_700 : N_800,
}));

export const syncedSources = [
  { name: "Notion", when: "2h ago", failed: false },
  { name: "Zendesk macros", when: "1d ago", failed: false },
  { name: "Drive · Ops", when: "failed", failed: true },
] as const;

export const kbReadiness = [
  { label: "Top intents covered", value: "41 / 47", hot: false },
  { label: "Documents older than a year", value: "19", hot: true },
  { label: "Contradictions detected", value: "3", hot: true },
  { label: "Unused documents", value: "28", hot: false },
] as const;

/* ─── AI tuning ────────────────────────────────────────────────────────── */

export const tuneNav = [
  { name: "Persona & tone", badge: "", on: true },
  { name: "Authority limits", badge: "3 changed", on: false },
  { name: "Escalation triggers", badge: "1 new", on: false },
  { name: "Never do this", badge: "", on: false },
  { name: "Languages & voice", badge: "5", on: false },
  { name: "Fine-tuning data", badge: "1,204 calls", on: false },
  { name: "Redaction & privacy", badge: "", on: false },
].map((t) => ({
  ...t,
  edge: t.on ? ACCENT : "transparent",
  badgeColor: t.badge.includes("new") || t.badge.includes("changed") ? ACCENT_700 : N_500,
}));

export const toneSliders = [
  { label: "Warmth", value: "6 / 10", bar: "60%", low: "clinical", high: "effusive" },
  { label: "Brevity", value: "8 / 10", bar: "80%", low: "thorough", high: "terse" },
  { label: "Formality", value: "4 / 10", bar: "40%", low: "casual", high: "formal" },
  { label: "Persistence", value: "3 / 10", bar: "30%", low: "hands over early", high: "keeps trying" },
] as const;

export const authority = [
  { action: "Goodwill credit", ceiling: "£50", escalate: "Manager approval", uses: "112", low: false },
  { action: "Reschedule delivery", ceiling: "unlimited", escalate: "—", uses: "308", low: false },
  { action: "Partial refund", ceiling: "£120", escalate: "Manager approval", uses: "41", low: false },
  { action: "Full refund", ceiling: "blocked", escalate: "Human only", uses: "0", low: true },
  { action: "Waive a fee", ceiling: "blocked", escalate: "Manager approval", uses: "0", low: true },
  { action: "Send secure payment link", ceiling: "any amount", escalate: "—", uses: "76", low: false },
  { action: "Change contract or tier", ceiling: "blocked", escalate: "Owner only", uses: "0", low: true },
].map((a) => ({ ...a, color: a.low ? ACCENT_700 : TEXT }));

export const escalationTriggers = [
  { text: 'Customer says "cancel", "solicitor", "ombudsman" or "complaint"', on: true },
  { text: "Asks for a human twice", on: true },
  { text: "Sentiment drops below −0.40", on: true },
  { text: "Request exceeds an authority ceiling", on: true },
  { text: "No document matches above 60% confidence", on: true },
  { text: "Priority score above 85", on: false, isNew: true },
  { text: "Bereavement or vulnerability language detected", on: false },
] as const;

export const neverDo = [
  "Promise a delivery date not confirmed by the courier feed",
  "Discuss another customer's order, ever",
  "Take card details by voice — always send a secure link",
  "Give legal or health advice",
  "Claim to be human if asked directly",
  "Offer a discount to prevent a cancellation",
] as const;

export const replayDelta = [
  { label: "Containment on 200 replays", from: "68%", to: "64%", worse: true },
  { label: "Escalations", from: "32", to: "41", worse: true },
  { label: "Guardrail breaches", from: "2", to: "0", worse: false },
] as const;

export const versionHistory = [
  { version: "v11", by: "21 Aug · D. Rahman", note: "Raised goodwill ceiling to £50; added Premier promise wording." },
  { version: "v10", by: "2 Aug · J. Okafor", note: "Blocked discounting as a retention tool after two bad calls." },
  { version: "v9", by: "14 Jul · D. Rahman", note: "Added Swedish and Portuguese; tightened refusal phrasing." },
] as const;

/* ─── Segments & rules ─────────────────────────────────────────────────── */

export const weights = [
  { label: "Churn risk", weight: "1.00", bar: "100%", source: "model" },
  { label: "Revenue / LTV", weight: "0.90", bar: "90%", source: "model" },
  { label: "Contract tier & SLA", weight: "0.85", bar: "85%", source: "manual" },
  { label: "Sentiment from calls", weight: "0.75", bar: "75%", source: "model" },
  { label: "Payment reliability", weight: "0.70", bar: "70%", source: "model" },
  { label: "Escalation likelihood", weight: "0.65", bar: "65%", source: "model" },
  { label: "Cost to serve", weight: "0.55", bar: "55%", source: "manual" },
  { label: "Advocacy / NPS", weight: "0.50", bar: "50%", source: "model" },
  { label: "Engagement / usage", weight: "0.45", bar: "45%", source: "model" },
  { label: "Expansion potential", weight: "0.40", bar: "40%", source: "manual" },
  { label: "Risk flags", weight: "0.30", bar: "30%", source: "rules" },
].map((w) => ({ ...w, color: parseFloat(w.weight) >= 0.75 ? ACCENT : N_700 }));

export const rules = [
  { name: "Tier 1 + cancellation intent", effect: "+14", condition: "tier = 1 AND intent contains cancellation", action: "add 14 to priority, alert #cx-urgent", matches: "9 customers", author: "D. Rahman · 12 Aug", hot: true },
  { name: "Trade renewal window", effect: "+10", condition: "segment = trade AND renewal in ≤ 30 days", action: "add 10, assign account owner", matches: "31 customers", author: "J. Okafor · 4 Aug", hot: true },
  { name: "Third service failure", effect: "+18", condition: "service failures ≥ 3 in 90 days", action: "add 18, force human on next contact", matches: "6 customers", author: "D. Rahman · 28 Jul", hot: true },
  { name: "Silent VIP", effect: "+6", condition: "LTV ≥ £10,000 AND no contact in 60 days", action: "add 6, create outreach task", matches: "47 customers", author: "A. Lindberg · 19 Jul", hot: false },
  { name: "Chronic low-value complainer", effect: "−12", condition: "contacts ≥ 8 in 30 days AND LTV < £500", action: "subtract 12, keep with AI", matches: "22 customers", author: "D. Rahman · 2 Jul", hot: false },
].map((r) => ({ ...r, tagBg: r.hot ? ACCENT_200 : N_200, tagFg: r.hot ? ACCENT_800 : N_800 }));

export const segments = [
  { name: "High priority", count: "38", owner: "shared" },
  { name: "Churn watch", count: "214", owner: "D. Rahman" },
  { name: "Trade accounts", count: "906", owner: "J. Okafor" },
  { name: "Silent VIPs", count: "47", owner: "A. Lindberg" },
  { name: "Payment risk", count: "68", owner: "Finance" },
  { name: "Expansion candidates", count: "129", owner: "Sales" },
] as const;

const DIST = [8, 14, 22, 34, 48, 62, 74, 86, 92, 88, 76, 64, 52, 44, 38, 32, 26, 20, 14, 9];
export const dist = DIST.map((h, i) => ({ h: pct(h), color: i >= 15 ? ACCENT : N_400 }));

export const simulation = [
  { label: "High priority (≥75)", from: "38", to: "51", hot: true },
  { label: "Accounts with no owner", from: "12", to: "4", hot: false },
  { label: "Est. daily human calls", from: "44", to: "57", hot: true },
  { label: "Revenue covered by a human", from: "61%", to: "83%", hot: false },
] as const;

export const modelAlerts = [
  { name: "Priority crosses 85", action: "Slack #cx-urgent + assign a manager", urgent: true },
  { name: "Tier 1 goes quiet 30 days", action: "Email the account owner", urgent: false },
  { name: "Expansion signal detected", action: "Create a task for sales", urgent: false },
] as const;

/* ─── Analytics ────────────────────────────────────────────────────────── */

export const kpis = [
  { label: "AI containment", value: "71.4%", delta: "+3.1", note: "vs last week", good: true },
  { label: "First-contact resolution", value: "84%", delta: "+1.4", note: "all channels", good: true },
  { label: "Cost per contact", value: "£0.68", delta: "−£0.11", note: "human £4.90", good: true },
  { label: "Avg handle time", value: "3m 41s", delta: "−22s", note: "AI legs only", good: true },
  { label: "Escalation rate", value: "28.6%", delta: "+0.9", note: "of all contacts", good: false },
  { label: "CSAT after AI", value: "4.4 / 5", delta: "+0.2", note: "1,982 responses", good: true },
].map((k) => ({ ...k, deltaColor: k.good ? N_800 : ACCENT_700 }));

export const weeks = (
  [[52, 30], [55, 29], [54, 31], [58, 28], [57, 30], [61, 27], [63, 26], [62, 28], [66, 25], [68, 24], [70, 23], [71, 22]] as const
).map(([ai, human]) => ({ ai: pct(ai), human: pct(human) }));

/** `to` names the screen that fixes the intent — the "Fix" link target. */
export const intents = [
  { name: "Part-delivery refunds", calls: "142", reason: "No document", cost: "£1,240 / mo", fix: "Draft policy", bad: true, to: "/app/knowledge" },
  { name: "Fee waivers after service failure", calls: "98", reason: "Authority ceiling", cost: "£860 / mo", fix: "Raise ceiling", bad: true, to: "/app/tuning" },
  { name: "Trade pricing for 10+ units", calls: "76", reason: "Contradictory docs", cost: "£710 / mo", fix: "Resolve conflict", bad: true, to: "/app/knowledge" },
  { name: "Assembly service area", calls: "64", reason: "No document", cost: "£520 / mo", fix: "Draft policy", bad: true, to: "/app/knowledge" },
  { name: "Complaints about an agent", calls: "41", reason: "Policy: human only", cost: "£410 / mo", fix: "Keep as is", bad: false, to: "/app/tuning" },
  { name: "Bereavement account closure", calls: "22", reason: "Policy: human only", cost: "£240 / mo", fix: "Keep as is", bad: false, to: "/app/tuning" },
  { name: "Contract tier changes", calls: "18", reason: "Blocked action", cost: "£190 / mo", fix: "Review block", bad: false, to: "/app/tuning" },
].map((i) => ({ ...i, reasonColor: i.bad ? ACCENT_700 : N_800 }));

export const qualityReview = [
  { label: "Answers with a citation", value: "96.4%", hot: false },
  { label: "Unsupported claims flagged", value: "11", hot: true },
  { label: "Guardrail breaches blocked", value: "4", hot: false },
  { label: "Calls reviewed by a human", value: "312 · 8%", hot: false },
  { label: "Average review score", value: "4.3 / 5", hot: false },
] as const;

export const agents = [
  { name: "Dania Rahman", role: "Manager", handled: "38", aht: "7m 12s", csat: "4.8", top: true },
  { name: "Joseph Okafor", role: "Manager", handled: "31", aht: "8m 04s", csat: "4.6", top: true },
  { name: "Anna Lindberg", role: "Agent", handled: "96", aht: "5m 48s", csat: "4.7", top: true },
  { name: "Ravi Mehta", role: "Agent", handled: "88", aht: "6m 31s", csat: "4.1", top: false },
  { name: "Marta Nowak", role: "Agent", handled: "74", aht: "5m 12s", csat: "4.5", top: true },
].map((a) => ({ ...a, csatColor: a.top ? N_800 : ACCENT_700 }));

export const channelMix = [
  { name: "Phone", share: "58%", primary: true },
  { name: "WhatsApp", share: "19%", primary: false },
  { name: "Web chat", share: "14%", primary: false },
  { name: "Email", share: "9%", primary: false },
] as const;

/* ─── Team & roles ─────────────────────────────────────────────────────── */

const YES = TEXT;
const NO = N_400;
const PART = ACCENT_700;

export const matrix = [
  { cap: "See customer records", cells: ["Full", "Full", "Full", "Assigned brand", "Read-only"], c: [YES, YES, YES, PART, PART] },
  { cap: "Take and end live calls", cells: ["Yes", "Yes", "Yes", "Yes", "No"], c: [YES, YES, YES, YES, NO] },
  { cap: "Approve above-ceiling actions", cells: ["Any", "No", "Up to £500", "No", "No"], c: [YES, NO, PART, NO, NO] },
  { cap: "Edit AI persona & guardrails", cells: ["Yes", "Yes", "Propose only", "No", "No"], c: [YES, YES, PART, NO, NO] },
  { cap: "Publish knowledge documents", cells: ["Yes", "Yes", "Yes", "Draft only", "No"], c: [YES, YES, YES, PART, NO] },
  { cap: "Change scoring weights & rules", cells: ["Yes", "Yes", "No", "No", "No"], c: [YES, YES, NO, NO, NO] },
  { cap: "Export transcripts", cells: ["Yes", "Yes", "Yes", "No", "Yes"], c: [YES, YES, YES, NO, YES] },
  { cap: "Manage people & roles", cells: ["Yes", "Yes", "Own team", "No", "No"], c: [YES, YES, PART, NO, NO] },
  { cap: "Billing, plan & residency", cells: ["Yes", "No", "No", "No", "No"], c: [YES, NO, NO, NO, NO] },
] as const;

export const ROLES = ["Owner", "Admin", "Manager", "Agent", "Analyst"] as const;

export const people = [
  { name: "Priya Chandrasekaran", email: "priya@aureliusgroup.com", role: "Owner", brands: "All 4 brands", status: "Active", active: "12 min ago" },
  { name: "Dania Rahman", email: "dania@aureliusgroup.com", role: "Manager", brands: "Aurelius Home", status: "On call", active: "now" },
  { name: "Joseph Okafor", email: "joseph@aureliusgroup.com", role: "Manager", brands: "Aurelius Trade", status: "Active", active: "3 min ago" },
  { name: "Anna Lindberg", email: "anna@aureliusgroup.com", role: "Agent", brands: "Aurelius Home, Lindholm", status: "On call", active: "now" },
  { name: "Ravi Mehta", email: "ravi@aureliusgroup.com", role: "Agent", brands: "Aurelius Home", status: "Away", active: "42 min ago" },
  { name: "Marta Nowak", email: "marta@aureliusgroup.com", role: "Agent", brands: "Lindholm", status: "Active", active: "8 min ago" },
  { name: "Tobias Fenwick", email: "tobias@aureliusgroup.com", role: "Analyst", brands: "All 4 brands", status: "Active", active: "1 hour ago" },
  { name: "Elena Moretti", email: "elena@casaverde.pt", role: "Admin", brands: "Casa Verde (pilot)", status: "Invited", active: "—" },
].map((p) => ({
  ...p,
  tagBg: p.status === "On call" ? ACCENT_200 : N_200,
  tagFg: p.status === "On call" ? ACCENT_800 : N_800,
}));

export const brandAccess = [
  { name: "Aurelius Home", people: "21 people" },
  { name: "Aurelius Trade", people: "9 people" },
  { name: "Lindholm", people: "6 people" },
  { name: "Casa Verde (pilot)", people: "2 people" },
] as const;

export const recentActivity = [
  { who: "D. Rahman", what: "raised the goodwill ceiling to £50 · 2h ago" },
  { who: "J. Okafor", what: "approved a £8,410 credit note · 4h ago" },
  { who: "A. Lindberg", what: 'published knowledge doc "Care guide" · yesterday' },
  { who: "Owner", what: "invited 3 people to Aurelius Trade · yesterday" },
  { who: "R. Mehta", what: "exported 1,204 transcripts for tuning · 2 days ago" },
] as const;

/* ─── Setup & channels ─────────────────────────────────────────────────── */

export const brands = [
  { initials: "AH", name: "Aurelius Home", meta: "Retail · 24,318 customers · agent Margot v11", status: "Live", live: true },
  { initials: "AT", name: "Aurelius Trade", meta: "Trade · 906 accounts · agent Bennett v6", status: "Live", live: true },
  { initials: "LH", name: "Lindholm", meta: "Retail · 4,102 customers · agent Sten v3", status: "Live", live: true },
  { initials: "CV", name: "Casa Verde", meta: "Trade pilot · 128 accounts · no agent yet", status: "Setup", live: false },
].map((b) => ({ ...b, tagBg: b.live ? ACCENT_200 : N_200, tagFg: b.live ? ACCENT_800 : N_800 }));

export const channels = [
  { name: "Helpline", detail: "+44 20 7946 0102 · AI answers in 1.4s", status: "Live", live: true },
  { name: "WhatsApp", detail: "Business number verified", status: "Live", live: true },
  { name: "Web chat", detail: "Embedded on aureliushome.co.uk", status: "Live", live: true },
  { name: "Email", detail: "help@aureliushome.co.uk", status: "AI drafts only", live: false },
] as const;

export const hoursFallback = [
  { label: "AI answers", value: "24 / 7" },
  { label: "Humans available", value: "Mon–Sat, 08:00–20:00" },
  { label: "Out of hours escalation", value: "Callback booked automatically" },
  { label: "If Corva is unreachable", value: "Forward to +44 20 7946 0188" },
] as const;

export const integrations = [
  { name: "Shopify", purpose: "Orders, refunds, customers", status: "Synced 2m ago", ok: true },
  { name: "Stripe", purpose: "Payments, failed charges, credits", status: "Synced 5m ago", ok: true },
  { name: "Twilio", purpose: "Helpline numbers and SMS", status: "Connected", ok: true },
  { name: "Notion", purpose: "Knowledge base source", status: "Synced 2h ago", ok: true },
  { name: "Slack", purpose: "Alerts and escalations", status: "Connected", ok: true },
  { name: "Snowflake", purpose: "Event stream to the warehouse", status: "Streaming", ok: true },
  { name: "Google Drive · Ops", purpose: "Knowledge base source", status: "Auth expired", ok: false },
].map((g) => ({ ...g, color: g.ok ? N_800 : ACCENT_700 }));

export const privacy = [
  { label: "Storage region", value: "EU · London" },
  { label: "Transcript retention", value: "24 months, then anonymised" },
  { label: "Redaction at capture", value: "Card, bank, health terms" },
  { label: "Your data trains", value: "Only your own agent" },
  { label: "Right-to-erasure requests", value: "Automated · 4 open" },
  { label: "SSO / SCIM", value: "Okta · enforced" },
] as const;

export const planUsage = [
  { label: "Projected invoice · September", value: "£5,704.62" },
  { label: "Brands in use", value: "4 of 5" },
  { label: "Contract renews", value: "1 Feb 2027" },
] as const;
