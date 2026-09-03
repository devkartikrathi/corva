/**
 * Fixtures for the platform operator console — Corva's own staff view across
 * every tenant. Ported from `design/Corva Operator Console.dc.html`.
 *
 * This surface is dark, so its palette references differ from the tenant
 * console: ink is the ground and `--color-bg` is the ink.
 */
import { operatorConfig } from "./config";

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_400 = "var(--color-accent-400)";
const ACCENT_800 = "var(--color-accent-800)";
const BG = "var(--color-bg)";
const N_300 = "var(--color-neutral-300)";
const N_500 = "var(--color-neutral-500)";
const N_600 = "var(--color-neutral-600)";
const N_800 = "var(--color-neutral-800)";

const pct = (n: number) => `${n}%`;

/* ─── Fleet ────────────────────────────────────────────────────────────── */

export const fleetKpis = [
  { label: "Companies", value: "148", delta: "+9", note: "this month", good: true },
  { label: "MRR", value: "£412k", delta: "+6.2%", note: "MoM", good: true },
  { label: "Conversations / mo", value: "1.21M", delta: "+11%", note: "all tenants", good: true },
  { label: "Fleet containment", value: "66.8%", delta: "+1.9", note: "weighted", good: true },
  { label: "Companies below SLA", value: "3", delta: "+3", note: "eu-west-2", good: false },
  { label: "At-risk MRR", value: "£31.4k", delta: "−£4k", note: "vs last month", good: true },
].map((k) => ({ ...k, deltaColor: k.good ? ACCENT_400 : ACCENT }));

export const tenants = [
  { slug: "northmoor-estates", name: "Northmoor Estates", meta: "Property · 3 brands · Leeds", plan: "Operator", conv: "41,200", containment: "48.1%", health: "54 · falling", healthV: 54, mrr: "£12,772", flag: "Health drop", bad: true },
  { slug: "halvard-retail", name: "Halvard Retail AB", meta: "Retail · 1 brand · Oslo", plan: "Trial", conv: "1,840", containment: "22.4%", health: "31 · never tuned", healthV: 31, mrr: "£0", flag: "Trial ending", bad: true },
  { slug: "vantage-living", name: "Vantage Living", meta: "Subscription · 2 brands · Sydney", plan: "Enterprise", conv: "88,400", containment: "69.2%", health: "62 · latency", healthV: 62, mrr: "£26,100", flag: "Residency ask", bad: true },
  { slug: "kessel-co", name: "Kessel & Co", meta: "Wholesale · 1 brand · Hamburg", plan: "Studio", conv: "23,900", containment: "74.8%", health: "78 · over plan", healthV: 78, mrr: "£9,980", flag: "Upgrade", bad: true },
  { slug: "pemberton-interiors", name: "Pemberton Interiors", meta: "Trade · 1 brand · Manchester", plan: "Studio", conv: "9,120", containment: "61.0%", health: "71 · steady", healthV: 71, mrr: "£3,830", flag: "Watch", bad: true },
  { slug: "aurelius-group", name: "Aurelius Group", meta: "Retail + trade · 4 brands · London", plan: "Operator", conv: "18,402", containment: "71.4%", health: "91 · healthy", healthV: 91, mrr: "£5,704", flag: "Reference", bad: false },
  { slug: "casa-verde", name: "Casa Verde Ltd", meta: "Trade · 1 brand · Lisbon", plan: "Studio", conv: "4,410", containment: "68.7%", health: "84 · healthy", healthV: 84, mrr: "£1,852", flag: "Expanding", bad: false },
  { slug: "lindqvist-mobler", name: "Lindqvist Möbler", meta: "Retail · 2 brands · Stockholm", plan: "Operator", conv: "31,600", containment: "76.2%", health: "88 · healthy", healthV: 88, mrr: "£9,796", flag: "Healthy", bad: false },
  { slug: "marchetti-cucine", name: "Marchetti Cucine", meta: "Retail · 1 brand · Lyon", plan: "Studio", conv: "6,240", containment: "70.1%", health: "86 · healthy", healthV: 86, mrr: "£2,620", flag: "Healthy", bad: false },
  { slug: "bruun-interior", name: "Bruun Interiør", meta: "Retail · 1 brand · Oslo", plan: "Operator", conv: "27,100", containment: "79.4%", health: "94 · healthy", healthV: 94, mrr: "£8,401", flag: "Advocate", bad: false },
].map((t) => ({
  ...t,
  healthBar: pct(t.healthV),
  // Below the configured threshold a tenant's health bar turns accent.
  healthColor: t.healthV < operatorConfig.healthThreshold ? ACCENT : N_500,
  tagBg: t.bad ? ACCENT_800 : N_800,
  tagFg: t.bad ? ACCENT_200 : N_300,
}));

/** Platform load over the last 24 hours. */
const LOAD = [22, 18, 15, 12, 11, 14, 24, 42, 64, 78, 86, 92, 88, 84, 90, 94, 82, 70, 58, 46, 38, 32, 28, 24];
export const load = LOAD.map((h) => ({ h: pct(h), color: h > 85 ? ACCENT : N_600 }));

export const needsCorva = [
  { name: "Northmoor Estates", note: "Containment fell 18 points after they published 40 documents. Suspect contradictions.", urgent: true },
  { name: "Halvard Retail AB", note: "Trial ends in 3 days, has never opened Tuning. No knowledge base connected.", urgent: true },
  { name: "Vantage Living", note: "Asked for data residency in Australia. No region there yet.", urgent: false },
  { name: "Kessel & Co", note: "92% of plan used with 11 days left. Offer an upgrade.", urgent: false },
] as const;

export const fleetFilters = ["All 148", "Trialling", "Enterprise", "Churn risk"] as const;

/* ─── Company detail ───────────────────────────────────────────────────── */

export const tenantUsage = [
  { label: "Voice minutes", value: "41,208" },
  { label: "Knowledge documents", value: "412 across 4 brands" },
  { label: "API calls / day", value: "1.2M" },
  { label: "Warehouse streaming", value: "Snowflake · on" },
] as const;

export const tenantBrands = [
  { name: "Aurelius Home", conv: "11,204 conv", containment: "71.4%", agent: "Margot v11", good: true },
  { name: "Aurelius Trade", conv: "4,980 conv", containment: "64.2%", agent: "Bennett v6", good: true },
  { name: "Lindholm", conv: "2,102 conv", containment: "78.8%", agent: "Sten v3", good: true },
  { name: "Casa Verde", conv: "116 conv", containment: "—", agent: "not set up", good: false },
].map((b) => ({ ...b, color: b.good ? BG : ACCENT_400 }));

export const tenantHealth = [
  { label: "Containment", value: "71.4%", extra: "+3.1", hot: false },
  { label: "Answers with a citation", value: "96.4%", hot: false },
  { label: "Unsupported claims flagged", value: "11 this month", hot: true },
  { label: "Guardrail breaches blocked", value: "4", hot: false },
  { label: "Documented intent coverage", value: "41 / 47", hot: false },
  { label: "Tuning versions shipped", value: "11 · avg 12 days apart", hot: false },
] as const;

export const featureFlags = [
  { name: "Multi-brand workspaces", note: "Generally available", on: true },
  { name: "Custom scoring axes (SQL)", note: "Beta · 24 companies", on: true },
  { name: "Private fine-tuning", note: "Enterprise only", on: true },
  { name: "corva-voice-4.3 canary", note: "Rolling out", on: false },
  { name: "Proactive outbound calls", note: "Alpha · needs legal sign-off", on: false },
  { name: "Agent copilot in the console", note: "Internal only", on: false },
].map((f) => ({ ...f, trackBg: f.on ? ACCENT : "var(--color-neutral-700)", knob: f.on ? 18 : 2 }));

export const supportAccess = [
  { label: "Current grant", value: "None" },
  { label: "Last grant", value: "2h, 14 Aug · R. Vance" },
  { label: "Reason required", value: "Yes" },
] as const;

export const tenantBilling = [
  { label: "MRR", value: "£5,704", hot: false },
  { label: "Lifetime", value: "£78,420", hot: false },
  { label: "Payment method", value: "BACS · on file", hot: false },
  { label: "Overdue", value: "None", hot: false },
  { label: "Expansion signal", value: "5th brand in setup", hot: true },
] as const;

export const accountNotes = [
  { when: "28 Aug", note: "Priya wants a Slack-first escalation flow. Roadmap." },
  { when: "14 Aug", note: "Debugged a Drive sync failure with Dania. Auth expires again in Oct." },
  { when: "2 Jul", note: "Reference call agreed for the furniture vertical." },
] as const;

/* ─── AI quality ───────────────────────────────────────────────────────── */

export const qualityKpis = [
  { label: "Fleet containment", value: "66.8%", note: "this month", delta: "+1.9", good: true },
  { label: "Citation rate", value: "94.1%", note: "target 97%" },
  { label: "Unsupported claims", value: "0.31%", note: "of all AI turns" },
  { label: "Bad handoffs", value: "2.4%", note: "brief judged unusable" },
  { label: "Voice p95 latency", value: "1.9s", note: "eu-west-2", delta: "+0.4s", good: false },
] as const;

export const flaggedTurns = [
  { company: "Northmoor Estates", klass: "Unsupported claim", turns: "31", cause: "Doc contradiction", owner: "Fleet eval", bad: true },
  { company: "Halvard Retail AB", klass: "No citation found", turns: "24", cause: "Empty KB", owner: "Onboarding", bad: true },
  { company: "Vantage Living", klass: "Invented a date", turns: "19", cause: "Vague document", owner: "Fleet eval", bad: true },
  { company: "Pemberton Interiors", klass: "Thin handoff brief", turns: "14", cause: "Short call", owner: "Fleet eval", bad: true },
  { company: "Kessel & Co", klass: "Tone breach", turns: "9", cause: "Persona drift", owner: "Tenant", bad: false },
  { company: "Aurelius Group", klass: "Unsupported claim", turns: "6", cause: "Fee schedule", owner: "Tenant", bad: false },
  { company: "Marchetti Cucine", klass: "Language switch failure", turns: "5", cause: "FR → IT", owner: "Fleet eval", bad: true },
  { company: "Lindqvist Möbler", klass: "Over-apologising", turns: "4", cause: "Persona", owner: "Tenant", bad: false },
].map((f) => ({ ...f, color: f.bad ? ACCENT_400 : N_300 }));

export const centralPatterns = [
  {
    title: "Dates invented from vague documents",
    count: "61 tenants",
    body: 'When a document says "3–5 working days" the model sometimes states a specific date. Fix: refuse specifics unless a feed confirms them.',
    primary: true,
  },
  {
    title: "Over-apologising loops",
    count: "34 tenants",
    body: "Three or more apologies in a call correlates with a −0.2 sentiment drop.",
    primary: false,
  },
  {
    title: "Thin handoff briefs on short calls",
    count: "28 tenants",
    body: "Calls under 90 seconds produce briefs agents rate 2 / 5.",
    primary: false,
  },
] as const;

export const rollout = [
  { label: "corva-voice-4.2", value: "92% of fleet", hot: false },
  { label: "corva-voice-4.3 canary", value: "8% · 12 tenants", hot: false },
  { label: "Canary containment", value: "+2.4 pts", hot: true },
  { label: "Canary breaches", value: "0", hot: false },
] as const;

/* ─── Revenue & plans ──────────────────────────────────────────────────── */

export const revenueKpis = [
  { label: "MRR", value: "£412,880", note: "MoM", delta: "+6.2%", good: true },
  { label: "Net revenue retention", value: "118%", note: "expansion led" },
  { label: "Gross margin", value: "74%", note: "after inference & telephony" },
  { label: "Trials open", value: "22", note: "9 with no knowledge base" },
  { label: "At-risk MRR", value: "£31,400", note: "5 companies" },
] as const;

/** MRR by month, as [base, usage-above-plan] percentages. */
export const mrrByMonth = (
  [[58, 6], [62, 8], [66, 9], [70, 11], [74, 12], [78, 14], [80, 16], [84, 17], [86, 19], [88, 21], [90, 23], [92, 26]] as const
).map(([base, expansion]) => ({ base: pct(base), expansion: pct(expansion) }));

export const planMix = [
  { label: "Studio · £0.42 / conv", value: "71 companies · £62k", bar: "48%", color: "var(--color-neutral-700)" },
  { label: "Operator · £0.31 / conv", value: "62 companies · £198k", bar: "42%", color: ACCENT },
  { label: "Enterprise · negotiated", value: "15 companies · £152k", bar: "10%", color: "var(--color-accent-500)" },
] as const;

export const atRisk = [
  { name: "Northmoor Estates", mrr: "£12,772", risk: "High", why: "Containment fell 18 points; champion left in July; two unanswered emails.", high: true },
  { name: "Vantage Living", mrr: "£26,100", risk: "High", why: "Blocked on Australian residency; contract clause expires in November.", high: true },
  { name: "Halvard Retail AB", mrr: "£0", risk: "Trial", why: "Trial ends Saturday with no knowledge base and no tuning session booked.", high: true },
  { name: "Pemberton Interiors", mrr: "£3,830", risk: "Medium", why: "Usage flat for three months; only one seat active.", high: false },
  { name: "Kessel & Co", mrr: "£9,980", risk: "Medium", why: "Repeatedly over plan and complaining about overage billing.", high: false },
].map((r) => ({ ...r, tagBg: r.high ? ACCENT_800 : N_800, tagFg: r.high ? ACCENT_200 : N_300 }));

export const unitEconomics = [
  { label: "Revenue per resolved conversation", value: "£0.34 blended" },
  { label: "Inference + telephony cost", value: "£0.089" },
  { label: "Contribution per conversation", value: "£0.251" },
  { label: "CAC payback", value: "7.4 months" },
  { label: "Cost of the free trial", value: "£1,840 / mo" },
] as const;

/* ─── Reliability ──────────────────────────────────────────────────────── */

export const regions = [
  { name: "eu-west-1 · Dublin", tenants: "61", p95: "1.4s", uptime: "99.99%", state: "Healthy", bad: false },
  { name: "eu-west-2 · London", tenants: "48", p95: "2.9s", uptime: "99.82%", state: "Degraded", bad: true },
  { name: "us-east-1 · Virginia", tenants: "33", p95: "1.5s", uptime: "99.98%", state: "Healthy", bad: false },
  { name: "ap-southeast-2 · Sydney", tenants: "6", p95: "1.8s", uptime: "99.97%", state: "Edge only", bad: false },
].map((r) => ({
  ...r,
  color: r.bad ? ACCENT : BG,
  tagBg: r.bad ? ACCENT_800 : N_800,
  tagFg: r.bad ? ACCENT_200 : N_300,
}));

export const dependencies = [
  { name: "Voice model", detail: "corva-voice-4.2 · 4.3 canary", state: "Healthy", bad: false },
  { name: "Telephony", detail: "Twilio · 2 carriers", state: "Degraded UK", bad: true },
  { name: "Retrieval index", detail: "184k documents · 3.1M chunks", state: "Healthy", bad: false },
  { name: "Warehouse egress", detail: "41 companies streaming", state: "Healthy", bad: false },
] as const;

export const incidents = [
  { when: "Now", dur: "42m open", title: "Voice latency in eu-west-2", sev: "Sev 2", note: "Carrier route degraded. Failover staged; 14 companies affected, 3 past their SLA threshold.", bad: true },
  { when: "29 Aug", dur: "18m", title: "Retrieval index lag", sev: "Sev 3", note: "New documents took up to 9 minutes to become answerable. No wrong answers served.", bad: false },
  { when: "21 Aug", dur: "6m", title: "Dashboard read timeouts", sev: "Sev 3", note: "Analytics queries only; calls unaffected.", bad: false },
  { when: "11 Aug", dur: "1h 04m", title: "WhatsApp webhook backlog", sev: "Sev 2", note: "Messages delivered late. 22 companies notified, credits applied automatically.", bad: true },
  { when: "2 Aug", dur: "12m", title: "Model provider rate limit", sev: "Sev 3", note: "Fell back to the secondary provider; containment dipped 4 points for the window.", bad: false },
].map((i) => ({ ...i, tagBg: i.bad ? ACCENT_800 : N_800, tagFg: i.bad ? ACCENT_200 : N_300 }));
