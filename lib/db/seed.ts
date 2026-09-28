/**
 * Seeds the database with the world the designs describe.
 *
 * Everything here is domain data, not presentation data: money is paise,
 * scores are 0–100, and the derived values the screens show (bar widths, tag
 * colours, blended priority) are computed from these rows rather than stored.
 *
 * Idempotent — it truncates first, so it is safe to re-run. Every table below
 * must be reachable by `CASCADE` from one of the roots in that TRUNCATE, or
 * named in it directly; a table that is neither makes the second run fail on a
 * duplicate key partway through and leaves the database half-seeded.
 */
import "./script-env";
import { sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

/** Rupees in, paise out. Every amount below is written in rupees. */
const paise = (rupees: number) => Math.round(rupees * 100);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);

/* ─── Reference data ───────────────────────────────────────────────────── */

const AXES = [
  { key: "churn_risk", label: "Churn risk", source: "model", inverted: false, weight: 1.0 },
  { key: "revenue_ltv", label: "Revenue / LTV", source: "model", inverted: false, weight: 0.9 },
  { key: "contract_tier", label: "Contract tier & SLA", source: "manual", inverted: false, weight: 0.85 },
  { key: "sentiment", label: "Sentiment from calls", source: "model", inverted: true, weight: 0.75 },
  { key: "payment_reliability", label: "Payment reliability", source: "model", inverted: true, weight: 0.7 },
  { key: "escalation_likelihood", label: "Escalation likelihood", source: "model", inverted: false, weight: 0.65 },
  { key: "cost_to_serve", label: "Cost to serve", source: "manual", inverted: false, weight: 0.55 },
  { key: "advocacy_nps", label: "Advocacy / NPS", source: "model", inverted: true, weight: 0.5 },
  { key: "engagement", label: "Engagement / usage", source: "model", inverted: true, weight: 0.45 },
  { key: "expansion_potential", label: "Expansion potential", source: "manual", inverted: false, weight: 0.4 },
  { key: "risk_flags", label: "Risk flags", source: "rules", inverted: false, weight: 0.3 },
] as const;

/**
 * What a plan costs, per seat per month, in rupees.
 *
 * Here rather than spelled into each tenant's MRR, because the fleet's revenue
 * screen adds these up and a hand-written total that disagrees with plan ×
 * seats is the kind of number that teaches people not to trust the screen.
 */
const PLAN_PRICE = { trial: 0, studio: 2499, operator: 3499, enterprise: 4999 } as const;
/** Enterprise carries a platform fee on top of its seats. */
const ENTERPRISE_FLOOR = 99_000;

const monthlyRupees = (plan: keyof typeof PLAN_PRICE, seats: number) =>
  plan === "trial" ? 0 : seats * PLAN_PRICE[plan] + (plan === "enterprise" ? ENTERPRISE_FLOOR : 0);

/**
 * Where a tenant's rows physically live.
 *
 * Mumbai first and by default, because that is where the customers are and
 * because voice is the channel that cannot hide a round trip — 200ms of extra
 * latency is audible on a phone call in a way it never is on a dashboard.
 * Singapore is the fallback, and Dublin exists for the one thing residency is
 * actually asked about: a tenant with European end customers.
 */
const REGIONS = [
  { key: "ap-south-1", label: "ap-south-1 · Mumbai", voiceP95Ms: 1200, uptime30d: "99.98", state: "healthy" },
  { key: "ap-south-2", label: "ap-south-2 · Hyderabad", voiceP95Ms: 2900, uptime30d: "99.81", state: "degraded" },
  { key: "ap-southeast-1", label: "ap-southeast-1 · Singapore", voiceP95Ms: 1600, uptime30d: "99.97", state: "healthy" },
  { key: "eu-west-1", label: "eu-west-1 · Dublin", voiceP95Ms: 2400, uptime30d: "99.96", state: "edge_only" },
] as const;

const FLAGS = [
  { key: "multi_brand", label: "Multi-brand workspaces", note: "Generally available", defaultOn: true, stage: "ga", rollout: 100 },
  { key: "custom_axes_sql", label: "Custom scoring axes (SQL)", note: "Beta", defaultOn: false, stage: "beta", rollout: 16 },
  { key: "private_fine_tuning", label: "Private fine-tuning", note: "Enterprise only", defaultOn: false, stage: "beta", rollout: 8 },
  { key: "voice_43_canary", label: "corva-voice-4.3 canary", note: "Rolling out", defaultOn: false, stage: "alpha", rollout: 4 },
  { key: "proactive_outbound", label: "Proactive outbound calls", note: "Alpha · needs legal sign-off", defaultOn: false, stage: "alpha", rollout: 2 },
  { key: "agent_copilot", label: "Agent copilot in the console", note: "Internal only", defaultOn: false, stage: "internal", rollout: 1 },
] as const;

/* ─── Tenants ──────────────────────────────────────────────────────────── */

const ORGS = [
  { slug: "aurelius-group", name: "Aurelius Group", plan: "operator", region: "ap-south-1", health: 91, seats: 34, renews: "2027-02-01" },
  { slug: "northmoor-estates", name: "Northmoor Interiors", plan: "operator", region: "ap-south-1", health: 54, seats: 41 },
  { slug: "halvard-retail", name: "Halvard Retail", plan: "trial", region: "ap-south-1", health: 31, seats: 3 },
  { slug: "vantage-living", name: "Vantage Living", plan: "enterprise", region: "ap-southeast-1", health: 62, seats: 88 },
  { slug: "kessel-co", name: "Kesari & Co", plan: "studio", region: "ap-south-1", health: 78, seats: 12 },
  { slug: "pemberton-interiors", name: "Pemberton Interiors", plan: "studio", region: "ap-south-1", health: 71, seats: 14 },
  { slug: "casa-verde", name: "Casa Verde Ltd", plan: "studio", region: "ap-south-1", health: 84, seats: 6 },
  { slug: "lindqvist-mobler", name: "Lokhande Furniture", plan: "operator", region: "ap-south-1", health: 88, seats: 22 },
  { slug: "marchetti-cucine", name: "Mistry Kitchens", plan: "studio", region: "ap-south-1", health: 86, seats: 9 },
  { slug: "bruun-interior", name: "Bhandari Interior", plan: "operator", region: "ap-southeast-1", health: 94, seats: 17 },
] as const;

/**
 * The other 138 tenants.
 *
 * The operator console's whole job is judgement across a fleet, and a fleet of
 * ten does not exercise it — sorting, filtering, the health cutoff and the
 * revenue mix all only mean something at scale. These are generated from a
 * fixed seed so the numbers are stable between runs and a screenshot taken
 * today still matches the database tomorrow.
 */
function generatedOrgs() {
  const first = ["Anantara", "Bhavani", "Chandra", "Devkota", "Ekanth", "Gulmohar", "Haveli", "Indira", "Jamuna", "Kanchan", "Lalbagh", "Mahindra", "Nilgiri", "Orchid", "Palash", "Rajwada", "Sarvam", "Tarangini", "Udyan", "Vasant", "Wadia", "Yamuna", "Zarina", "Amrapali", "Banyan", "Chinar"];
  const second = ["Interiors", "Living", "& Sons", "Furnishings", "Studio", "Group", "Home", "Atelier", "Works", "Collective", "Furniture", "Design"];
  const plans = ["trial", "studio", "studio", "operator", "operator", "enterprise"] as const;
  // Weighted to Mumbai, because that is where almost everyone is.
  const regions = ["ap-south-1", "ap-south-1", "ap-south-1", "ap-south-2", "ap-southeast-1"] as const;

  // A small deterministic PRNG. Math.random would make every run a new fleet.
  let state = 0x2f6e2b1;
  const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];

  const seen = new Set<string>();
  const out: { slug: string; name: string; plan: (typeof plans)[number]; region: string; health: number; mrr: number; seats: number; renewDays: number }[] = [];

  while (out.length < 138) {
    const name = `${pick(first)} ${pick(second)}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (seen.has(slug)) continue;
    seen.add(slug);

    const plan = pick(plans);
    const seats = plan === "trial" ? 2 + Math.floor(next() * 5)
      : plan === "studio" ? 5 + Math.floor(next() * 15)
      : plan === "operator" ? 15 + Math.floor(next() * 40)
      : 50 + Math.floor(next() * 120);
    const mrr = monthlyRupees(plan, seats);
    // Health skews high — a fleet where half the tenants are failing is not a
    // fleet anyone is still operating.
    const health = Math.min(99, Math.max(18, Math.round(58 + next() * 46 - (plan === "trial" ? 22 : 0))));

    out.push({ slug, name, plan, region: pick(regions), health, mrr, seats, renewDays: 10 + Math.floor(next() * 340) });
  }
  return out;
}

/**
 * `modelId` is spread on purpose rather than left to default.
 *
 * The two brands taking real traffic sit on models we would put behind an
 * authority ceiling; the one that is only ever demonstrated sits on the cheap
 * one. That is the actual shape of the decision the account screen makes, and a
 * fleet where every brand is identical would not show it.
 */
const AURELIUS_BRANDS = [
  { slug: "aurelius-home", name: "Aurelius Home", initials: "AH", segment: "Retail", location: "Mumbai", timezone: "Asia/Kolkata", agentName: "Meera", isLive: true, modelId: "gemini-3.6-flash" },
  { slug: "aurelius-trade", name: "Aurelius Trade", initials: "AT", segment: "Trade", location: "Pune", timezone: "Asia/Kolkata", agentName: "Arjun", isLive: true, modelId: "gemini-3.5-flash" },
  { slug: "lindholm", name: "Lakhani Living", initials: "LL", segment: "Retail", location: "Bengaluru", timezone: "Asia/Kolkata", agentName: "Nisha", isLive: true, modelId: "gemini-3.5-flash" },
  { slug: "casa-verde", name: "Casa Verde", initials: "CV", segment: "Trade", location: "Goa", timezone: "Asia/Kolkata", agentName: null, isLive: false, modelId: "gemini-3.5-flash-lite" },
] as const;

/**
 * The workspace's people.
 *
 * `rating` and `availability` are here because routing reads them: when the AI
 * hands over a call it picks whoever is free and best rated, and a seed where
 * everybody is offline and unrated would make that choice unobservable. The
 * two Agents on Aurelius Home are deliberately different — Ravi is available
 * and rated highest, Anaya is available and rated slightly lower — so the
 * ordering the router applies is visible rather than asserted.
 *
 * Dania is the default profile the console opens as. She is a Manager, which
 * is the screen with the most on it; the sidebar's switcher is how you become
 * an Agent and watch two thirds of it disappear.
 */
const PEOPLE = [
  { email: "priya@aureliusgroup.com", name: "Priya Chandrasekaran", role: "owner", allBrands: true, brands: [], lastActiveMins: 12, availability: "busy", rating: null, specialities: [] },
  { email: "dania@aureliusgroup.com", name: "Dania Rahman", role: "manager", allBrands: false, brands: ["aurelius-home"], lastActiveMins: 0, availability: "available", rating: 4.6, specialities: ["escalations", "goodwill"] },
  { email: "joseph@aureliusgroup.com", name: "Jyoti Okhandiar", role: "manager", allBrands: false, brands: ["aurelius-trade"], lastActiveMins: 3, availability: "busy", rating: 4.4, specialities: ["trade", "invoicing"] },
  { email: "anna@aureliusgroup.com", name: "Anaya Lamba", role: "agent", allBrands: false, brands: ["aurelius-home", "lindholm"], lastActiveMins: 0, availability: "available", rating: 4.3, specialities: ["deliveries"] },
  { email: "ravi@aureliusgroup.com", name: "Ravi Mehta", role: "agent", allBrands: false, brands: ["aurelius-home"], lastActiveMins: 4, availability: "available", rating: 4.8, specialities: ["refunds", "deliveries"] },
  { email: "marta@aureliusgroup.com", name: "Meghna Naik", role: "agent", allBrands: false, brands: ["lindholm"], lastActiveMins: 8, availability: "offline", rating: 4.1, specialities: ["warranty"] },
  { email: "tobias@aureliusgroup.com", name: "Tarun Phadke", role: "analyst", allBrands: true, brands: [], lastActiveMins: 60, availability: "offline", rating: null, specialities: [] },
  { email: "elena@casaverde.pt", name: "Elena Moraes", role: "admin", allBrands: false, brands: ["casa-verde"], invited: true, availability: "offline", rating: null, specialities: [] },
] as const;

/* ─── Customers ────────────────────────────────────────────────────────── */

type Sig = Partial<Record<(typeof AXES)[number]["key"], number>>;

/**
 * Five customers, not fifty.
 *
 * The scoring model needs all eleven axes on every customer or the "why this
 * number" panel has nothing to explain, so the depth per row is real. The
 * *number* of rows is not: a console with forty invented people in it is
 * harder to reason about than one with five, and none of the screens here are
 * demonstrating scale — that job belongs to the operator console's fleet.
 *
 * Between them they cover the four states the console has to render: an
 * account a person holds and is in trouble on (Meera), a trade account in a
 * billing dispute (Sundaram), one the AI runs entirely on its own
 * (Bhavani), and a quiet healthy one (Rohan).
 *
 * `ownerEmail` is the account's owner. Null means the AI holds it alone, which
 * is a real state in this product and not an oversight — it is what the
 * Manager's "held by the AI alone" figure counts.
 */
const CUSTOMERS: {
  ref: string;
  name: string;
  segment: string;
  tier: string;
  location: string;
  /** Lifetime value, in rupees. */
  ltv: number;
  ownerEmail: string | null;
  sinceDays: number;
  email?: string;
  phone?: string;
  signals: Sig;
  sentimentDisplay: string;
}[] = [
  { ref: "AH-CU-40912", name: "Meera Okhale", segment: "Retail", tier: "Tier 1", location: "Bandra, Mumbai", ltv: 1_249_500, ownerEmail: "ravi@aureliusgroup.com", sinceDays: 2380, email: "meera.okhale@fastmail.com", phone: "+91 98200 41187",
    signals: { churn_risk: 84, revenue_ltv: 92, sentiment: 34, escalation_likelihood: 77, engagement: 48, payment_reliability: 96, cost_to_serve: 71, advocacy_nps: 22, contract_tier: 90, expansion_potential: 61, risk_flags: 4 }, sentimentDisplay: "−0.32" },
  { ref: "AH-CU-40913", name: "Sundaram Interiors", segment: "Trade", tier: "14 seats", location: "Pune", ltv: 8_443_750, ownerEmail: "joseph@aureliusgroup.com", sinceDays: 1200, phone: "+91 90040 22910",
    signals: { churn_risk: 71, revenue_ltv: 96, sentiment: 41, escalation_likelihood: 68, payment_reliability: 44, contract_tier: 80, cost_to_serve: 62, advocacy_nps: 40, engagement: 70, expansion_potential: 55, risk_flags: 30 }, sentimentDisplay: "−0.18" },
  { ref: "AH-CU-40914", name: "Sofia Lobo", segment: "Retail", tier: "Tier 2", location: "Panjim, Goa", ltv: 344_750, ownerEmail: "anna@aureliusgroup.com", sinceDays: 640, phone: "+91 99230 55471",
    signals: { churn_risk: 66, revenue_ltv: 48, sentiment: 29, escalation_likelihood: 72, payment_reliability: 88, contract_tier: 50, cost_to_serve: 68, advocacy_nps: 35, engagement: 52, expansion_potential: 30, risk_flags: 12 }, sentimentDisplay: "−0.41" },
  { ref: "AH-CU-40918", name: "Bhavani Rao", segment: "Retail", tier: "Tier 2", location: "Hyderabad", ltv: 588_875, ownerEmail: null, sinceDays: 800, phone: "+91 96400 71225",
    signals: { churn_risk: 31, revenue_ltv: 60, sentiment: 68, escalation_likelihood: 28, payment_reliability: 94, contract_tier: 50, cost_to_serve: 36, advocacy_nps: 62, engagement: 66, expansion_potential: 44, risk_flags: 5 }, sentimentDisplay: "+0.36" },
  { ref: "AH-CU-40922", name: "Rohan Nadkarni", segment: "Retail", tier: "Tier 1", location: "Bengaluru", ltv: 1_041_250, ownerEmail: null, sinceDays: 2000, phone: "+91 80500 33418",
    signals: { churn_risk: 12, revenue_ltv: 74, sentiment: 83, escalation_likelihood: 10, payment_reliability: 97, contract_tier: 85, cost_to_serve: 20, advocacy_nps: 74, engagement: 18, expansion_potential: 48, risk_flags: 1 }, sentimentDisplay: "+0.66" },
];

/**
 * The other two live brands.
 *
 * Thinner than Aurelius Home on purpose: switching brands should visibly
 * change the console, and a second brand that looks identical to the first
 * proves nothing about brand scoping.
 */
const OTHER_BRAND_CUSTOMERS: {
  brand: string;
  ref: string;
  name: string;
  segment: string;
  tier: string;
  location: string;
  ltv: number;
  ownerEmail: string | null;
  sinceDays: number;
  signals: Sig;
}[] = [
  { brand: "aurelius-trade", ref: "AT-CU-2201", name: "Redgrave Contracts", segment: "Trade", tier: "22 seats", location: "Pune", ltv: 12_425_000, ownerEmail: "joseph@aureliusgroup.com", sinceDays: 1450,
    signals: { churn_risk: 62, revenue_ltv: 94, contract_tier: 88, sentiment: 44, payment_reliability: 58, escalation_likelihood: 61, cost_to_serve: 66, advocacy_nps: 38, engagement: 74, expansion_potential: 72, risk_flags: 22 } },
  { brand: "aurelius-trade", ref: "AT-CU-2202", name: "Whitlock & Bhatia", segment: "Trade", tier: "8 seats", location: "Ahmedabad", ltv: 3_403_750, ownerEmail: null, sinceDays: 700,
    signals: { churn_risk: 28, revenue_ltv: 62, contract_tier: 55, sentiment: 74, payment_reliability: 91, escalation_likelihood: 22, cost_to_serve: 34, advocacy_nps: 72, engagement: 68, expansion_potential: 48, risk_flags: 4 } },
  { brand: "lindholm", ref: "LH-CU-5501", name: "Ananya Bergi", segment: "Retail", tier: "Tier 1", location: "Bengaluru", ltv: 752_500, ownerEmail: "marta@aureliusgroup.com", sinceDays: 1100,
    signals: { churn_risk: 55, revenue_ltv: 66, contract_tier: 70, sentiment: 40, payment_reliability: 88, escalation_likelihood: 52, cost_to_serve: 48, advocacy_nps: 44, engagement: 40, expansion_potential: 36, risk_flags: 8 } },
  { brand: "lindholm", ref: "LH-CU-5502", name: "Prateek Halbe", segment: "Retail", tier: "Tier 2", location: "Mysuru", ltv: 271_250, ownerEmail: null, sinceDays: 420,
    signals: { churn_risk: 24, revenue_ltv: 32, contract_tier: 40, sentiment: 78, payment_reliability: 92, escalation_likelihood: 18, cost_to_serve: 26, advocacy_nps: 74, engagement: 62, expansion_potential: 24, risk_flags: 3 } },
];

/* ─── What Corva mirrors from the tenant's other systems ───────────────── */

/**
 * Orders and invoices that live in the tenant's commerce and payments stack.
 * Corva does not own them; it mirrors them so the agent can answer "where is
 * my order" without a person going to look.
 *
 * Four rows, covering the two customers whose conversations turn on them. A
 * mirrored ledger for a customer nobody rings about is data that exists only
 * to look like data.
 */
const RECORDS: { ref: string; kind: string; id: string; label: string; status: string; amount: number | null; source: string; daysAgo: number }[] = [
  { ref: "AH-CU-40912", kind: "order", id: "AH-88213", label: "Marlow 3-seat sofa · Ink", status: "Rescheduled ×3", amount: 161_000, source: "Shopify", daysAgo: 34 },
  { ref: "AH-CU-40912", kind: "delivery", id: "DL-55120", label: "Booked · Thursday, morning slot", status: "Scheduled", amount: null, source: "Courier feed", daysAgo: -3 },
  { ref: "AH-CU-40913", kind: "invoice", id: "IN-20988", label: "March trade invoice", status: "Disputed", amount: 736_000, source: "Razorpay", daysAgo: 12 },
  { ref: "AH-CU-40913", kind: "subscription", id: "SUB-4410", label: "Trade account · 14 seats", status: "Active", amount: 34_986, source: "Razorpay", daysAgo: 1200 },
];

/** Where a customer's contract renews, for the renewal-window rules. */
const RENEWALS: Record<string, number> = {
  "AH-CU-40913": 18,
  "AH-CU-40922": 240,
};

/** Only the customer whose consent state a screen actually turns on. */
const CONSENTS: { ref: string; kind: string; granted: boolean; detail: string }[] = [
  { ref: "AH-CU-40912", kind: "call_recording", granted: true, detail: "Verbal, recorded 8 Mar" },
  { ref: "AH-CU-40912", kind: "marketing", granted: false, detail: "Withdrawn via preference centre, Jan" },
];

const NOTES: { ref: string; author: string; body: string; pinned: boolean; daysAgo: number }[] = [
  { ref: "AH-CU-40912", author: "R. Mehta", body: "Third reschedule. If this slips again we owe a fixed slot and the ₹5,000 credit, not another window — do not let the AI offer a window.", pinned: true, daysAgo: 2 },
  { ref: "AH-CU-40913", author: "J. Okhandiar", body: "Invoice dispute is a genuine duplicate line from the March migration. Finance is issuing a credit note; do not argue the amount.", pinned: true, daysAgo: 3 },
];

/* ─── Knowledge sources ────────────────────────────────────────────────── */

const SOURCES = [
  { name: "Notion · Customer Ops", kind: "notion", status: "synced", docCount: 6, syncedMins: 120, error: null },
  { name: "Freshdesk macros", kind: "zendesk", status: "synced", docCount: 2, syncedMins: 360, error: null },
  { name: "Google Drive · Ops", kind: "drive", status: "error", docCount: 0, syncedMins: 2880, error: "OAuth token expired — reconnect to resume" },
  { name: "Manual uploads", kind: "upload", status: "synced", docCount: 2, syncedMins: 60, error: null },
] as const;

/* ─── Model alerts ─────────────────────────────────────────────────────── */

const MODEL_ALERTS = [
  { kind: "drift", severity: "warn", title: "Churn risk drifted 6 points in 14 days", detail: "The mean churn-risk signal across Aurelius Home rose from 38 to 44 with no change in weighting. Either the population changed or the upstream model did.", axisKey: "churn_risk", status: "open", daysAgo: 2 },
  { kind: "stale_signal", severity: "warn", title: "Expansion potential has not refreshed in 31 days", detail: "The expansion model last ran on 4 August. Anything scored since is using a month-old value at weight 0.4.", axisKey: "expansion_potential", status: "open", daysAgo: 5 },
  { kind: "rule_conflict", severity: "critical", title: "Two rules disagree on chronic complainers", detail: "\u201cThird service failure\u201d adds 18 and \u201cChronic low-value complainer\u201d subtracts 12 for the same eight customers. The net +6 is nobody's intent.", axisKey: null, status: "open", daysAgo: 1 },
  { kind: "coverage", severity: "info", title: "Risk flags is set for 4 of 12 customers", detail: "The axis carries weight 0.3 but is populated for a third of the brand, so it mostly contributes nothing.", axisKey: "risk_flags", status: "acknowledged", daysAgo: 9 },
] as const;

/* ─── Saved views ──────────────────────────────────────────────────────── */

const SAVED_VIEWS = [
  { surface: "customers", name: "All", query: {}, isDefault: true, shared: true },
  { surface: "customers", name: "Needs attention", query: { minScore: "70", sort: "score" }, isDefault: false, shared: true },
  { surface: "customers", name: "Trade, tier 1", query: { segment: "Trade", tier: "Tier 1" }, isDefault: false, shared: true },
  { surface: "customers", name: "Payment risk", query: { flag: "payment", sort: "score" }, isDefault: false, shared: true },
  { surface: "conversations", name: "Everything", query: {}, isDefault: true, shared: true },
  { surface: "conversations", name: "AI could not finish", query: { outcome: "no_document" }, isDefault: false, shared: true },
  { surface: "conversations", name: "Phone only", query: { channel: "phone" }, isDefault: false, shared: true },
] as const;

/* ─── Platform dependencies ────────────────────────────────────────────── */

const DEPENDENCIES = [
  { key: "voice_asr", label: "Speech recognition", provider: "Deepgram", state: "healthy", note: "p95 210ms", latencyMs: 210 },
  { key: "voice_tts", label: "Speech synthesis", provider: "ElevenLabs", state: "healthy", note: "p95 340ms", latencyMs: 340 },
  { key: "llm_primary", label: "Primary model", provider: "Anthropic", state: "healthy", note: "p95 1.1s", latencyMs: 1100 },
  { key: "llm_fallback", label: "Fallback model", provider: "Google", state: "healthy", note: "Cold, last used 32d ago", latencyMs: 1400 },
  { key: "embeddings", label: "Embeddings", provider: "Google", state: "healthy", note: "p95 90ms", latencyMs: 90 },
  { key: "telephony", label: "Telephony", provider: "Exotel", state: "degraded", note: "Carrier route degraded in ap-south-2", latencyMs: 2900 },
  { key: "postgres", label: "Primary database", provider: "Neon", state: "healthy", note: "p95 14ms", latencyMs: 14 },
  { key: "whatsapp", label: "WhatsApp Business", provider: "Meta", state: "healthy", note: "Webhook lag 1.2s", latencyMs: 1200 },
] as const;

/* ─── Cross-tenant quality ─────────────────────────────────────────────── */

const QUALITY = [
  { failureClass: "unsupported_claim", summary: "Promised a delivery slot the courier feed had not confirmed", rootCause: "Retrieval returned the service promise but not the capacity check", owner: "corva", status: "triaged", daysAgo: 1 },
  { failureClass: "no_citation", summary: "Quoted a trade discount with no document behind it", rootCause: "Two documents contradict; the model picked the shorter one", owner: "tenant", status: "open", daysAgo: 1 },
  { failureClass: "invented_date", summary: "Gave a restock date that appears in no source", rootCause: "Model filled a gap rather than escalating", owner: "corva", status: "open", daysAgo: 2 },
  { failureClass: "wrong_entitlement", summary: "Applied a Premier window to a standard account", rootCause: "Entitlement lookup timed out and the agent proceeded anyway", owner: "corva", status: "triaged", daysAgo: 3 },
  { failureClass: "no_citation", summary: "Answered a fabric-care question from general knowledge", rootCause: "No document covers care beyond 24 months", owner: "tenant", status: "fixed", daysAgo: 6 },
  { failureClass: "unsupported_claim", summary: "Said a refund had been issued before it was", rootCause: "Action was refused; the reply was generated before the refusal landed", owner: "corva", status: "fixed", daysAgo: 8 },
  { failureClass: "tone_breach", summary: "Apologised four times in one exchange", rootCause: "Persona says never apologise twice; nothing enforces it", owner: "tenant", status: "open", daysAgo: 4 },
  { failureClass: "authority_bypass", summary: "Offered to waive an installation fee", rootCause: "Waiver is blocked for the AI but phrased as a suggestion, not an action", owner: "corva", status: "triaged", daysAgo: 5 },
] as const;

/* ─── Account notes (staff only) ───────────────────────────────────────── */

const ACCOUNT_NOTES = [
  { org: "northmoor-estates", kind: "risk", body: "Containment fell 11 points after they imported 300 Freshdesk macros as documents. Half contradict their own policy. Offered a cleanup session; no reply in nine days.", daysAgo: 3 },
  { org: "northmoor-estates", kind: "note", body: "Renewal is 41 days out and the champion left in July. New contact is in procurement, not CX.", daysAgo: 9 },
  { org: "halvard-retail", kind: "risk", body: "Trial ends Friday. Two brands created, no documents uploaded, agent never went live. This is a failed onboarding, not a pricing objection.", daysAgo: 1 },
  { org: "vantage-living", kind: "expansion", body: "Asked about private fine-tuning twice. 88 seats and growing; the flag is on for them already.", daysAgo: 6 },
  { org: "aurelius-group", kind: "note", body: "Best reference account on the fleet. Happy to be quoted; ask Priya, not the CX team.", daysAgo: 21 },
] as const;

/* ─── Business hours ───────────────────────────────────────────────────── */

/** Mon–Fri 09:00–18:00, Saturday 10:00–16:00, closed Sunday. */
const HOURS = [
  { weekday: 0, opens: 540, closes: 1080, closed: false },
  { weekday: 1, opens: 540, closes: 1080, closed: false },
  { weekday: 2, opens: 540, closes: 1080, closed: false },
  { weekday: 3, opens: 540, closes: 1080, closed: false },
  { weekday: 4, opens: 540, closes: 1080, closed: false },
  { weekday: 5, opens: 600, closes: 960, closed: false },
  { weekday: 6, opens: 0, closes: 0, closed: true },
] as const;

/* ─── Knowledge ────────────────────────────────────────────────────────── */

const DOCUMENTS = [
  {
    collection: "Service promises", title: "Service promise v4", kind: "Policy", owner: "D. Rahman",
    citations: 1204, success: 0.94, updatedDays: 6, status: "published" as const,
    chunks: [
      { anchor: "§1", content: "Aurelius Home commits to a named delivery day for every order over ₹50,000. Premier customers receive a four-hour arrival window confirmed the evening before." },
      { anchor: "§3.2", content: "Where a delivery has been rescheduled by Aurelius Home two or more times, the customer qualifies for a goodwill credit. The agent may apply up to ₹5,000 without approval. A third failure additionally entitles the customer to a fixed morning or afternoon slot rather than a window." },
      { anchor: "§4", content: "Goodwill credits are applied to the original payment method within five working days and do not affect the order's warranty start date." },
      { anchor: "§5", content: "Installation fees are separate from delivery and are governed by the current fee schedule. Waiving an installation fee is a manager decision and is never automatic." },
    ],
  },
  {
    collection: "Delivery & logistics", title: "Delivery ops playbook", kind: "Playbook", owner: "Ops team",
    citations: 208, success: 0.88, updatedDays: 21, status: "published" as const,
    chunks: [
      { anchor: "Fixed slots", content: "A fixed slot may be booked when the courier feed shows capacity. Morning slots run 08:00–12:00 and afternoon 12:00–17:00. Never promise a fixed slot without confirming capacity in the feed." },
      { anchor: "Reschedules", content: "Customers may reschedule without charge up to 48 hours before the booked day. Reschedules initiated by Aurelius Home are always free and are recorded against the order for service-promise purposes." },
    ],
  },
  {
    collection: "Payments & billing", title: "Fee schedule 2026", kind: "Reference", owner: "Finance",
    citations: 141, success: 0.71, updatedDays: 60, status: "published" as const,
    chunks: [
      { anchor: "Installation", content: "Standard installation is ₹7,500 for a single room and ₹12,500 for multi-room. The fee covers assembly, levelling and packaging removal." },
      { anchor: "Waivers", content: "Installation and delivery fees may be waived by a Manager. Agents and the AI may not waive fees under any circumstances. A waiver must record the reason and the order reference." },
    ],
  },
  {
    collection: "Warranty & repairs", title: "Warranty terms", kind: "Policy", owner: "Legal",
    citations: 126, success: 0.91, updatedDays: 35, status: "published" as const,
    chunks: [
      { anchor: "§7", content: "Frames carry a ten-year structural warranty. Upholstery and foam carry two years. Claims require photographs and the order reference; no visit is needed for a frame claim." },
    ],
  },
  {
    collection: "Payments & billing", title: "Refunds & goodwill", kind: "Policy", owner: "D. Rahman",
    citations: 98, success: 0.64, updatedDays: 270, status: "published" as const,
    chunks: [
      { anchor: "Partial", content: "Partial refunds up to ₹12,000 may be issued by an agent where goods are damaged on arrival. Note: this section is in tension with the fee schedule on who may authorise a refund above ₹12,000." },
    ],
  },
  {
    collection: "Trade accounts", title: "Trade discount tiers", kind: "Reference", owner: null,
    citations: 74, success: 0.52, updatedDays: 420, status: "published" as const,
    chunks: [
      { anchor: "Tiers", content: "Trade accounts receive 12% at ten units, 18% at twenty-five units and 25% above fifty units. These figures contradict the 2026 fee schedule and have not been reconciled." },
    ],
  },
  {
    collection: "Products & care", title: "Care guide · Lindholm", kind: "Product", owner: "Product",
    citations: 61, success: 0.96, updatedDays: 14, status: "published" as const,
    chunks: [
      { anchor: "Fabric", content: "Lindholm fabrics are cleaned with a damp cloth and mild soap. Do not use solvent cleaners. Cushions should be rotated monthly for the first year." },
    ],
  },
  {
    collection: "Service promises", title: "Escalation matrix", kind: "Playbook", owner: "D. Rahman",
    citations: 44, success: 0.89, updatedDays: 8, status: "published" as const,
    chunks: [
      { anchor: "Routing", content: "Cancellation intent, legal language, or any request beyond an authority ceiling routes to a Manager with a written brief. The AI holds the customer with a status update rather than ending the contact." },
    ],
  },
  {
    collection: "Tone & phrasing", title: "Tone of voice", kind: "Guide", owner: "Brand",
    citations: 0, success: null, updatedDays: 120, status: "published" as const,
    chunks: [
      { anchor: "Voice", content: "Direct and warm, never bubbly. Use the customer's name once, at the start. Never apologise twice for the same thing — fix it instead." },
    ],
  },
  {
    collection: "Delivery & logistics", title: "Assembly service area", kind: "Reference", owner: null,
    citations: 0, success: 0, updatedDays: 9999, status: "missing" as const,
    chunks: [],
  },
];

const GAPS = [
  { intent: "Part-delivery refunds", hits: 14, reason: "no_document" },
  { intent: "Assembly service area", hits: 9, reason: "no_document" },
  { intent: "Trade discount tiers", hits: 6, reason: "contradiction" },
  { intent: "Fabric care after 24 months", hits: 4, reason: "no_document" },
] as const;

/* ─── Agent configuration ──────────────────────────────────────────────── */

const PERSONA =
  "You are Meera, answering the phone for Aurelius Home, an Indian furniture retailer. Be direct and warm; never bubbly. Use the customer's name once, at the start. Never apologise twice for the same thing — fix it instead. If you don't know, say so and get a human. Never quote a price or a date you cannot see in the record. All amounts are in rupees.";

const AUTHORITY = [
  { action: "goodwill_credit", label: "Goodwill credit", ceiling: 5_000, blocked: false, escalateTo: "manager" },
  { action: "reschedule_delivery", label: "Reschedule delivery", ceiling: null, blocked: false, escalateTo: null },
  { action: "partial_refund", label: "Partial refund", ceiling: 12_000, blocked: false, escalateTo: "manager" },
  { action: "full_refund", label: "Full refund", ceiling: null, blocked: true, escalateTo: "human" },
  { action: "waive_fee", label: "Waive a fee", ceiling: null, blocked: true, escalateTo: "manager" },
  { action: "send_payment_link", label: "Send secure payment link", ceiling: null, blocked: false, escalateTo: null },
  { action: "change_contract", label: "Change contract or tier", ceiling: null, blocked: true, escalateTo: "owner" },
] as const;

const TRIGGERS = [
  { description: 'Customer says "cancel", "solicitor", "ombudsman" or "complaint"', rule: { kind: "phrase", any: ["cancel", "solicitor", "ombudsman", "complaint"] }, enabled: true },
  { description: "Asks for a human twice", rule: { kind: "human_requests", atLeast: 2 }, enabled: true },
  { description: "Sentiment drops below −0.40", rule: { kind: "sentiment", below: -0.4 }, enabled: true },
  { description: "Request exceeds an authority ceiling", rule: { kind: "authority_exceeded" }, enabled: true },
  { description: "No document matches above 60% confidence", rule: { kind: "retrieval_confidence", below: 0.6 }, enabled: true },
  { description: "Priority score above 85", rule: { kind: "priority", above: 85 }, enabled: false },
  { description: "Bereavement or vulnerability language detected", rule: { kind: "phrase", any: ["bereavement", "passed away", "vulnerable"] }, enabled: false },
] as const;

const NEVER = [
  "Promise a delivery date not confirmed by the courier feed",
  "Discuss another customer's order, ever",
  "Take card details by voice — always send a secure link",
  "Give legal or health advice",
  "Claim to be human if asked directly",
  "Offer a discount to prevent a cancellation",
] as const;

const RULES = [
  { name: "Tier 1 + cancellation intent", effect: 14, condition: { all: [{ field: "tier", op: "eq", value: "Tier 1" }, { field: "intent", op: "contains", value: "cancellation" }] }, actions: [{ kind: "alert", channel: "#cx-urgent" }], author: "D. Rahman", days: 22 },
  { name: "Trade renewal window", effect: 10, condition: { all: [{ field: "segment", op: "eq", value: "Trade" }, { field: "renewal_days", op: "lte", value: 30 }] }, actions: [{ kind: "assign_owner" }], author: "J. Okhandiar", days: 30 },
  { name: "Third service failure", effect: 18, condition: { all: [{ field: "service_failures_90d", op: "gte", value: 3 }] }, actions: [{ kind: "force_human" }], author: "D. Rahman", days: 37 },
  { name: "Silent VIP", effect: 6, condition: { all: [{ field: "ltv_paise", op: "gte", value: 5_00_00_000 }, { field: "days_since_contact", op: "gte", value: 60 }] }, actions: [{ kind: "create_task", queue: "outreach" }], author: "A. Lamba", days: 46 },
  { name: "Chronic low-value complainer", effect: -12, condition: { all: [{ field: "contacts_30d", op: "gte", value: 8 }, { field: "ltv_paise", op: "lt", value: 25_00_000 }] }, actions: [{ kind: "keep_with_ai" }], author: "D. Rahman", days: 63 },
] as const;

/**
 * Saved segments.
 *
 * Each is a stored filter in the same shape the customer table's URL carries,
 * so a segment's membership is counted rather than asserted — a saved segment
 * claiming 906 members in a brand with twelve customers is the kind of number
 * that teaches people not to trust the screen.
 */
const SEGMENTS = [
  { name: "High priority", query: { minScore: "70" }, owner: "shared" },
  { name: "Churn watch", query: { flag: "churn" }, owner: "D. Rahman" },
  { name: "Trade accounts", query: { segment: "Trade" }, owner: "J. Okhandiar" },
  { name: "Silent VIPs", query: { flag: "healthy", sort: "value:desc" }, owner: "A. Lamba" },
  { name: "Payment risk", query: { flag: "payment" }, owner: "Finance" },
  { name: "Expansion candidates", query: { flag: "expansion" }, owner: "Sales" },
] as const;

/* ─── Seed ─────────────────────────────────────────────────────────────── */

async function main() {
  console.log("Clearing…");
  await db.execute(sql`
    TRUNCATE TABLE
      ${s.organizations}, ${s.staff}, ${s.scoringAxes}, ${s.regions}, ${s.featureFlags},
      ${s.platformDependencies}
    RESTART IDENTITY CASCADE
  `);

  console.log("Reference data…");
  await db.insert(s.scoringAxes).values(
    AXES.map((a) => ({ key: a.key, label: a.label, source: a.source, inverted: a.inverted })),
  );
  await db.insert(s.regions).values(REGIONS.map((r) => ({ ...r })));
  await db.insert(s.featureFlags).values(
    FLAGS.map((f) => ({
      key: f.key,
      label: f.label,
      note: f.note,
      defaultOn: f.defaultOn,
      stage: f.stage,
      rolloutPercent: f.rollout,
    })),
  );

  const [operator] = await db
    .insert(s.staff)
    .values({ clerkUserId: "staff_seed_operator", email: "you@corva.systems", name: "Corva Operator", isAdmin: true })
    .returning();

  console.log("Organizations…");
  const fleet = generatedOrgs();
  const orgRows = await db
    .insert(s.organizations)
    .values([
      ...ORGS.map((o) => ({
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        region: o.region,
        healthScore: o.health,
        mrrPaise: paise(monthlyRupees(o.plan, o.seats)),
        seatCount: o.seats,
        renewsAt: "renews" in o && o.renews ? new Date(o.renews) : null,
      })),
      ...fleet.map((o) => ({
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        region: o.region,
        healthScore: o.health,
        mrrPaise: paise(o.mrr),
        seatCount: o.seats,
        renewsAt: daysAgo(-o.renewDays),
      })),
    ])
    .returning();
  const orgBySlug = new Map(orgRows.map((o) => [o.slug, o]));
  const aurelius = orgBySlug.get("aurelius-group")!;

  // Feature flags per tenant. Aurelius is explicit; the rest of the fleet is
  // spread to match each flag's stated rollout, so "Beta · 24 companies" on
  // the operator screen is a count of rows rather than a caption.
  const flagRows: { orgId: string; flagKey: string; enabled: boolean }[] = FLAGS.map((f) => ({
    orgId: aurelius.id,
    flagKey: f.key,
    enabled: f.defaultOn || f.key === "custom_axes_sql" || f.key === "private_fine_tuning",
  }));
  for (const [i, org] of orgRows.entries()) {
    if (org.id === aurelius.id) continue;
    for (const f of FLAGS) {
      // A stable hash of the position, so the same tenants keep the same flags.
      const on = ((i * 37 + f.key.length * 11) % 100) < f.rollout;
      if (on || f.defaultOn) flagRows.push({ orgId: org.id, flagKey: f.key, enabled: on || f.defaultOn });
    }
  }
  await db.insert(s.orgFeatureFlags).values(flagRows);

  console.log("Brands…");
  const brandRows = await db
    .insert(s.brands)
    .values(AURELIUS_BRANDS.map((b) => ({ ...b, orgId: aurelius.id })))
    .returning();
  const brandBySlug = new Map(brandRows.map((b) => [b.slug, b]));
  const home = brandBySlug.get("aurelius-home")!;

  console.log("Opening hours…");
  await db.insert(s.businessHours).values(
    brandRows.flatMap((b) =>
      HOURS.map((h) => ({
        brandId: b.id,
        weekday: h.weekday,
        opensMinute: h.opens,
        closesMinute: h.closes,
        closed: h.closed,
      })),
    ),
  );

  console.log("People…");
  const memberRows = await db
    .insert(s.memberships)
    .values(
      PEOPLE.map((p) => ({
        orgId: aurelius.id,
        // Real Clerk ids are attached on first sign-in; see lib/auth/link.ts.
        // A pending invite has no Clerk id yet — that is what makes it pending.
        clerkUserId: "invited" in p && p.invited ? null : `seed:${p.email}`,
        email: p.email,
        name: p.name,
        role: p.role,
        status: "invited" in p && p.invited ? ("invited" as const) : ("active" as const),
        inviteToken: "invited" in p && p.invited ? `inv_${p.email.split("@")[0]}` : null,
        invitedByName: "invited" in p && p.invited ? "Priya Chandrasekaran" : null,
        allBrands: p.allBrands,
        // Routing reads these before it reads anything else. An invited person
        // who has never signed in is offline whatever the fixture says.
        availability: "invited" in p && p.invited ? ("offline" as const) : p.availability,
        rating: p.rating,
        specialities: [...p.specialities],
        invitedAt: "invited" in p && p.invited ? daysAgo(2) : null,
        lastActiveAt: "lastActiveMins" in p ? minsAgo(p.lastActiveMins) : null,
      })),
    )
    .returning();
  const memberByEmail = new Map(memberRows.map((m) => [m.email, m]));

  const scopes = PEOPLE.flatMap((p) =>
    p.brands.map((slug) => ({
      membershipId: memberByEmail.get(p.email)!.id,
      brandId: brandBySlug.get(slug)!.id,
    })),
  );
  if (scopes.length) await db.insert(s.membershipBrands).values(scopes);

  console.log("Scoring model…");
  // Every brand is scored; only Aurelius Home has tuned weights away from the
  // defaults, which is what makes its "why this number" panel worth reading.
  await db.insert(s.brandAxisWeights).values(
    brandRows.flatMap((b) =>
      AXES.map((a) => ({ brandId: b.id, axisKey: a.key, weight: a.weight })),
    ),
  );
  await db.insert(s.priorityRules).values(
    RULES.map((r, i) => ({
      brandId: home.id,
      name: r.name,
      condition: r.condition,
      effect: r.effect,
      actions: r.actions,
      authorName: r.author,
      ordinal: i,
    })),
  );
  await db.insert(s.segments).values(
    SEGMENTS.map((seg) => ({
      brandId: home.id,
      name: seg.name,
      definition: { query: seg.query },
      ownerName: seg.owner,
    })),
  );

  console.log("Customers…");
  const customerRows = await db
    .insert(s.customers)
    .values(
      CUSTOMERS.map((c) => ({
        brandId: home.id,
        externalRef: c.ref,
        name: c.name,
        email: c.email ?? null,
        phone: c.phone ?? null,
        location: c.location,
        segment: c.segment,
        tier: c.tier,
        // The owning membership is the fact; the name beside it is a label the
        // lists and CSV exports read, kept in step here rather than joined.
        ownerMembershipId: c.ownerEmail ? memberByEmail.get(c.ownerEmail)!.id : null,
        owner: c.ownerEmail ? memberByEmail.get(c.ownerEmail)!.name : null,
        customerSince: daysAgo(c.sinceDays),
        renewsAt: RENEWALS[c.ref] ? daysAgo(-RENEWALS[c.ref]) : null,
        ltvPaise: paise(c.ltv),
      })),
    )
    .returning();

  // The other two live brands. Thinner, and deliberately different, so that
  // switching brand visibly changes the console rather than re-skinning it.
  const otherCustomerRows = await db
    .insert(s.customers)
    .values(
      OTHER_BRAND_CUSTOMERS.map((c) => ({
        brandId: brandBySlug.get(c.brand)!.id,
        externalRef: c.ref,
        name: c.name,
        location: c.location,
        segment: c.segment,
        tier: c.tier,
        ownerMembershipId: c.ownerEmail ? memberByEmail.get(c.ownerEmail)!.id : null,
        owner: c.ownerEmail ? memberByEmail.get(c.ownerEmail)!.name : null,
        customerSince: daysAgo(c.sinceDays),
        ltvPaise: paise(c.ltv),
      })),
    )
    .returning();

  const customerByRef = new Map(
    [...customerRows, ...otherCustomerRows].map((c) => [c.externalRef!, c]),
  );

  await db.insert(s.customerSignals).values([
    ...CUSTOMERS.flatMap((c) =>
      Object.entries(c.signals).map(([axisKey, value]) => ({
        customerId: customerByRef.get(c.ref)!.id,
        axisKey,
        value: value as number,
        display: axisKey === "sentiment" ? c.sentimentDisplay : null,
      })),
    ),
    ...OTHER_BRAND_CUSTOMERS.flatMap((c) =>
      Object.entries(c.signals).map(([axisKey, value]) => ({
        customerId: customerByRef.get(c.ref)!.id,
        axisKey,
        value: value as number,
      })),
    ),
  ]);

  await db.insert(s.customerRecords).values(
    RECORDS.map((r) => ({
      customerId: customerByRef.get(r.ref)!.id,
      kind: r.kind,
      ref: r.id,
      label: r.label,
      status: r.status,
      amountPaise: r.amount === null ? null : paise(r.amount),
      sourceSystem: r.source,
      occurredAt: daysAgo(r.daysAgo),
    })),
  );

  await db.insert(s.customerConsents).values(
    CONSENTS.map((c) => ({
      customerId: customerByRef.get(c.ref)!.id,
      kind: c.kind,
      granted: c.granted,
      detail: c.detail,
    })),
  );

  await db.insert(s.customerNotes).values(
    NOTES.map((n) => ({
      customerId: customerByRef.get(n.ref)!.id,
      authorName: n.author,
      body: n.body,
      pinned: n.pinned,
      createdAt: daysAgo(n.daysAgo),
    })),
  );

  console.log("Knowledge…");
  const docRows = await db
    .insert(s.documents)
    .values(
      DOCUMENTS.map((d) => ({
        brandId: home.id,
        collection: d.collection,
        title: d.title,
        kind: d.kind,
        body: d.chunks.map((c) => c.content).join("\n\n"),
        ownerName: d.owner,
        status: d.status,
        citationCount: d.citations,
        successRate: d.success,
        updatedAt: daysAgo(Math.min(d.updatedDays, 3650)),
      })),
    )
    .returning();
  const docByTitle = new Map(docRows.map((d) => [d.title, d]));

  const chunkValues = DOCUMENTS.flatMap((d) =>
    d.chunks.map((c, i) => ({
      documentId: docByTitle.get(d.title)!.id,
      brandId: home.id,
      ordinal: i,
      anchor: c.anchor,
      content: c.content,
    })),
  );
  if (chunkValues.length) await db.insert(s.documentChunks).values(chunkValues);

  await db.insert(s.knowledgeSources).values(
    SOURCES.map((src_) => ({
      brandId: home.id,
      name: src_.name,
      kind: src_.kind,
      status: src_.status,
      docCount: src_.docCount,
      lastSyncedAt: minsAgo(src_.syncedMins),
      error: src_.error,
    })),
  );

  // Revision 1 of everything, so a citation made today still resolves to the
  // text that was actually cited if the document is edited tomorrow.
  await db.insert(s.documentRevisions).values(
    docRows.map((d) => ({
      documentId: d.id,
      revision: 1,
      title: d.title,
      body: d.body,
      note: "Imported at seed",
      authorName: d.ownerName,
      createdAt: d.updatedAt,
    })),
  );

  await db.insert(s.knowledgeGaps).values(
    GAPS.map((g) => ({ brandId: home.id, intent: g.intent, hits: g.hits, reason: g.reason })),
  );

  await db.insert(s.modelAlerts).values(
    MODEL_ALERTS.map((a) => ({
      brandId: home.id,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      axisKey: a.axisKey,
      status: a.status,
      acknowledgedByName: a.status === "acknowledged" ? "D. Rahman" : null,
      acknowledgedAt: a.status === "acknowledged" ? daysAgo(a.daysAgo - 1) : null,
      createdAt: daysAgo(a.daysAgo),
    })),
  );

  await db.insert(s.savedViews).values(
    SAVED_VIEWS.map((v, i) => ({
      orgId: aurelius.id,
      // Null membership = everyone in the org sees it.
      membershipId: v.shared ? null : memberByEmail.get("dania@aureliusgroup.com")!.id,
      surface: v.surface,
      name: v.name,
      query: v.query,
      isDefault: v.isDefault,
      ordinal: i,
    })),
  );

  console.log("Agent versions…");
  const versionRows = await db
    .insert(s.agentVersions)
    .values([
      { brandId: home.id, version: 9, persona: PERSONA, tone: { warmth: 6, brevity: 7, formality: 4, persistence: 4 }, status: "retired", authorName: "D. Rahman", notes: "Added Swedish and Portuguese; tightened refusal phrasing.", publishedAt: daysAgo(51) },
      { brandId: home.id, version: 10, persona: PERSONA, tone: { warmth: 6, brevity: 8, formality: 4, persistence: 3 }, status: "retired", authorName: "J. Okhandiar", notes: "Blocked discounting as a retention tool after two bad calls.", publishedAt: daysAgo(32) },
      { brandId: home.id, version: 11, persona: PERSONA, tone: { warmth: 6, brevity: 8, formality: 4, persistence: 3 }, status: "live", authorName: "D. Rahman", notes: "Raised goodwill ceiling to ₹5,000; added Premier promise wording.", publishedAt: daysAgo(13) },
      { brandId: home.id, version: 12, persona: PERSONA, tone: { warmth: 6, brevity: 8, formality: 4, persistence: 3 }, status: "draft", authorName: "D. Rahman", notes: "Escalates earlier on Premier promises and high-priority accounts." },
    ])
    .returning();
  const live = versionRows.find((v) => v.status === "live")!;
  const draft = versionRows.find((v) => v.status === "draft")!;

  for (const v of [live, draft]) {
    await db.insert(s.authorityLimits).values(
      AUTHORITY.map((a) => ({
        agentVersionId: v.id,
        action: a.action,
        label: a.label,
        ceilingPaise: a.ceiling === null ? null : paise(a.ceiling),
        blocked: a.blocked,
        escalateTo: a.escalateTo,
      })),
    );
    await db.insert(s.escalationTriggers).values(
      TRIGGERS.map((t) => ({
        agentVersionId: v.id,
        description: t.description,
        rule: t.rule,
        // v12 is the version that turns the priority trigger on.
        enabled: v.id === draft.id && t.rule.kind === "priority" ? true : t.enabled,
      })),
    );
    await db.insert(s.neverRules).values(NEVER.map((n) => ({ agentVersionId: v.id, description: n })));
  }

  console.log("Channels & integrations…");
  await db.insert(s.channels).values([
    { brandId: home.id, kind: "phone", address: "+91 22 6817 0102", detail: "AI answers in 1.4s", state: "live" },
    { brandId: home.id, kind: "whatsapp", address: "+91 22 6817 0102", detail: "Business number verified", state: "live" },
    { brandId: home.id, kind: "web_chat", address: "aureliushome.in", detail: "Embedded site widget", state: "live" },
    { brandId: home.id, kind: "email", address: "help@aureliushome.in", detail: "AI drafts only", state: "drafts_only" },
    { brandId: home.id, kind: "sms", address: null, detail: null, state: "not_connected" },
  ]);

  await db.insert(s.integrations).values([
    { orgId: aurelius.id, name: "Shopify", purpose: "Orders, refunds, customers", status: "Synced 2m ago", healthy: true, lastSyncedAt: minsAgo(2) },
    { orgId: aurelius.id, name: "Razorpay", purpose: "Payments, failed charges, credits", status: "Synced 5m ago", healthy: true, lastSyncedAt: minsAgo(5) },
    { orgId: aurelius.id, name: "Exotel", purpose: "Helpline numbers and SMS", status: "Connected", healthy: true },
    { orgId: aurelius.id, name: "Notion", purpose: "Knowledge base source", status: "Synced 2h ago", healthy: true, lastSyncedAt: minsAgo(120) },
    { orgId: aurelius.id, name: "Slack", purpose: "Alerts and escalations", status: "Connected", healthy: true },
    { orgId: aurelius.id, name: "Snowflake", purpose: "Event stream to the warehouse", status: "Streaming", healthy: true },
    { orgId: aurelius.id, name: "Google Drive · Ops", purpose: "Knowledge base source", status: "Auth expired", healthy: false },
  ]);

  console.log("Privacy…");
  await db.insert(s.privacySettings).values({
    orgId: aurelius.id,
    retentionDays: 365,
    redactPii: true,
    trainOnTranscripts: false,
    recordCalls: true,
    dataRegion: aurelius.region,
    dpoEmail: "privacy@aureliusgroup.com",
    allowSupportAccess: true,
    updatedByName: "Priya Chandrasekaran",
    updatedAt: daysAgo(48),
  });

  console.log("Platform ops…");
  await db.insert(s.platformDependencies).values(
    DEPENDENCIES.map((d) => ({ ...d, checkedAt: minsAgo(1) })),
  );

  // Ninety days of traffic per tenant. Weekends dip, health scales volume,
  // and containment tracks health — so the operator charts have a shape that
  // means something rather than noise.
  const usage: (typeof s.usageDaily.$inferInsert)[] = [];
  const mrr: (typeof s.mrrSnapshots.$inferInsert)[] = [];
  for (const [i, org] of orgRows.entries()) {
    const health = org.healthScore ?? 60;
    const base = Math.max(4, Math.round(org.seatCount * 3.2));
    for (let d = 89; d >= 0; d--) {
      const day = new Date(daysAgo(d).toISOString().slice(0, 10));
      const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
      const wobble = 0.85 + (((i * 13 + d * 7) % 30) / 100);
      const total = Math.round(base * wobble * (weekend ? 0.42 : 1));
      const containment = Math.min(0.95, Math.max(0.3, health / 100 - 0.05));
      const contained = Math.round(total * containment);
      usage.push({
        orgId: org.id,
        day,
        conversations: total,
        contained,
        handoffs: total - contained,
        aiMinutes: Math.round(total * 3.4),
        humanMinutes: Math.round((total - contained) * 7.1),
        /**
         * Roughly ₹3.20 of model and telephony cost per AI minute.
         *
         * A blend across channels rather than a voice rate: a voice minute
         * costs several times a chat one, and most traffic is not voice. The
         * per-conversation truth is measured on the row itself
         * (`conversations.cost_paise`); this is the fleet-level approximation
         * the operator's charts read, and it is deliberately conservative
         * against the ₹27–36 a conversation is sold for.
         */
        costPaise: Math.round(total * 3.4 * 320),
      });
    }

    // Twelve months of recurring revenue, growing into today's figure.
    for (let m = 11; m >= 0; m--) {
      const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 1));
      const ramp = 1 - m * 0.035;
      mrr.push({
        orgId: org.id,
        month,
        mrrPaise: Math.max(0, Math.round(org.mrrPaise * ramp)),
        seatCount: Math.max(1, Math.round(org.seatCount * ramp)),
        plan: org.plan,
      });
    }
  }
  // Chunked: a single insert of ~15,000 rows exceeds the driver's statement size.
  for (let i = 0; i < usage.length; i += 2000) await db.insert(s.usageDaily).values(usage.slice(i, i + 2000));
  for (let i = 0; i < mrr.length; i += 2000) await db.insert(s.mrrSnapshots).values(mrr.slice(i, i + 2000));

  await db.insert(s.accountNotes).values(
    ACCOUNT_NOTES.map((n) => ({
      orgId: orgBySlug.get(n.org)!.id,
      staffId: operator.id,
      authorName: operator.name,
      kind: n.kind,
      body: n.body,
      createdAt: daysAgo(n.daysAgo),
    })),
  );

  await db.insert(s.incidents).values([
    { title: "Voice latency in ap-south-2", severity: "Sev 2", regionKey: "ap-south-2", note: "Carrier route degraded. Failover staged; 14 companies affected, 3 past their SLA threshold.", startedAt: minsAgo(42), affectedOrgCount: 14 },
    { title: "Retrieval index lag", severity: "Sev 3", regionKey: "ap-south-1", note: "New documents took up to 9 minutes to become answerable. No wrong answers served.", startedAt: daysAgo(5), resolvedAt: daysAgo(5), affectedOrgCount: 61 },
    { title: "Dashboard read timeouts", severity: "Sev 3", regionKey: "ap-south-2", note: "Analytics queries only; calls unaffected.", startedAt: daysAgo(13), resolvedAt: daysAgo(13), affectedOrgCount: 48 },
    { title: "WhatsApp webhook backlog", severity: "Sev 2", regionKey: null, note: "Messages delivered late. 22 companies notified, credits applied automatically.", startedAt: daysAgo(23), resolvedAt: daysAgo(23), affectedOrgCount: 22 },
    { title: "Model provider rate limit", severity: "Sev 3", regionKey: null, note: "Fell back to the secondary provider; containment dipped 4 points for the window.", startedAt: daysAgo(32), resolvedAt: daysAgo(32), affectedOrgCount: 148 },
  ]);

  const incidentRows = await db.select().from(s.incidents);
  const byTitle = new Map(incidentRows.map((i) => [i.title, i]));
  const voice = byTitle.get("Voice latency in ap-south-2")!;
  await db.insert(s.incidentUpdates).values([
    { incidentId: voice.id, stage: "investigating", body: "Voice p95 in ap-south-2 crossed 2.5s. Paging the telephony on-call.", authorName: "R. Vance", at: minsAgo(42) },
    { incidentId: voice.id, stage: "identified", body: "Carrier route degraded upstream of Exotel. Not our path; failover to the secondary carrier is staged and needs a go.", authorName: "R. Vance", at: minsAgo(28) },
    { incidentId: voice.id, stage: "monitoring", body: "Failover applied for the 14 affected companies. p95 back to 1.6s. Holding before we move the rest.", authorName: "S. Okonjo", at: minsAgo(9) },
    { incidentId: byTitle.get("Retrieval index lag")!.id, stage: "resolved", body: "Index workers scaled out. Backlog cleared in 6 minutes; no wrong answers were served during the window.", authorName: "S. Okonjo", at: daysAgo(5) },
  ]);

  await db.insert(s.qualityFlags).values(
    QUALITY.map((q, i) => ({
      // Spread across the fleet, because the point of the screen is that these
      // are patterns Corva owns rather than one tenant's problem.
      orgId: orgRows[(i * 17) % orgRows.length].id,
      failureClass: q.failureClass,
      summary: q.summary,
      rootCause: q.rootCause,
      owner: q.owner,
      status: q.status,
      assignedToStaffId: q.status === "open" ? null : operator.id,
      resolvedAt: q.status === "fixed" ? daysAgo(q.daysAgo - 1) : null,
      createdAt: daysAgo(q.daysAgo),
    })),
  );

  await db.insert(s.auditLog).values([
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("dania@aureliusgroup.com")!.id, actorName: "D. Rahman", action: "authority.ceiling_raised", target: "goodwill_credit", meta: { to: "₹5,000" }, at: minsAgo(120) },
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("joseph@aureliusgroup.com")!.id, actorName: "J. Okhandiar", action: "credit_note.approved", target: "₹7,36,000", meta: {}, at: minsAgo(240) },
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("anna@aureliusgroup.com")!.id, actorName: "A. Lamba", action: "document.published", target: "Care guide · Lindholm", meta: {}, at: daysAgo(1) },
    { orgId: aurelius.id, actorType: "user", actorId: memberByEmail.get("priya@aureliusgroup.com")!.id, actorName: "Owner", action: "people.invited", target: "Aurelius Trade", meta: { count: 3 }, at: daysAgo(1) },
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("ravi@aureliusgroup.com")!.id, actorName: "R. Mehta", action: "transcripts.exported", target: "tuning set", meta: { count: 1204 }, at: daysAgo(2) },
    { orgId: aurelius.id, actorType: "staff", actorId: operator.id, actorName: "R. Vance", action: "support_access.granted", target: "2 hours", meta: { reason: "Drive sync debugging" }, at: daysAgo(20) },
  ]);

  console.log("\nSeeded.");
  console.log(`  organizations ${orgRows.length}`);
  console.log(`  usage rows    ${usage.length} (90 days × fleet)`);
  console.log(`  mrr snapshots ${mrr.length} (12 months × fleet)`);
  console.log(`  brands        ${brandRows.length}`);
  console.log(`  people        ${memberRows.length}`);
  console.log(`  customers     ${customerRows.length + otherCustomerRows.length} across ${brandRows.length} brands`);
  console.log(`  documents     ${docRows.length} (${chunkValues.length} chunks, no embeddings yet)`);
  console.log(`  agent versions${versionRows.length}`);
  console.log("\nNext: npm run db:embed   — embed the chunks so retrieval works");
  console.log("      npm run db:conversations — replay the seeded conversations");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
