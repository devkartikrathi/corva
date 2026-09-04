/**
 * Seeds the database with the world the designs describe.
 *
 * Everything here is domain data, not presentation data: money is pence,
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

const pence = (pounds: number) => Math.round(pounds * 100);
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

const REGIONS = [
  { key: "eu-west-1", label: "eu-west-1 · Dublin", voiceP95Ms: 1400, uptime30d: "99.99", state: "healthy" },
  { key: "eu-west-2", label: "eu-west-2 · London", voiceP95Ms: 2900, uptime30d: "99.82", state: "degraded" },
  { key: "us-east-1", label: "us-east-1 · Virginia", voiceP95Ms: 1500, uptime30d: "99.98", state: "healthy" },
  { key: "ap-southeast-2", label: "ap-southeast-2 · Sydney", voiceP95Ms: 1800, uptime30d: "99.97", state: "edge_only" },
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
  { slug: "aurelius-group", name: "Aurelius Group", plan: "operator", region: "eu-west-2", health: 91, mrr: 5704, seats: 34, renews: "2027-02-01" },
  { slug: "northmoor-estates", name: "Northmoor Estates", plan: "operator", region: "eu-west-2", health: 54, mrr: 12772, seats: 41 },
  { slug: "halvard-retail", name: "Halvard Retail AB", plan: "trial", region: "eu-west-1", health: 31, mrr: 0, seats: 3 },
  { slug: "vantage-living", name: "Vantage Living", plan: "enterprise", region: "ap-southeast-2", health: 62, mrr: 26100, seats: 88 },
  { slug: "kessel-co", name: "Kessel & Co", plan: "studio", region: "eu-west-1", health: 78, mrr: 9980, seats: 12 },
  { slug: "pemberton-interiors", name: "Pemberton Interiors", plan: "studio", region: "eu-west-2", health: 71, mrr: 3830, seats: 14 },
  { slug: "casa-verde", name: "Casa Verde Ltd", plan: "studio", region: "eu-west-1", health: 84, mrr: 1852, seats: 6 },
  { slug: "lindqvist-mobler", name: "Lindqvist Möbler", plan: "operator", region: "eu-west-1", health: 88, mrr: 9796, seats: 22 },
  { slug: "marchetti-cucine", name: "Marchetti Cucine", plan: "studio", region: "eu-west-1", health: 86, mrr: 2620, seats: 9 },
  { slug: "bruun-interior", name: "Bruun Interiør", plan: "operator", region: "eu-west-1", health: 94, mrr: 8401, seats: 17 },
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
  const first = ["Halden", "Vireo", "Castellane", "Ferrow", "Oakhurst", "Skarpnäck", "Brindle", "Aventine", "Coultard", "Merisi", "Nordvik", "Thackeray", "Ilford", "Bellamy", "Quarnstrom", "Ravensworth", "Lyndhurst", "Peregrine", "Solvang", "Maitland", "Ashcombe", "Delacroix", "Fenwold", "Grimsby", "Havelock", "Inverleith"];
  const second = ["Interiors", "Living", "& Sons", "Furnishings", "Studio", "Group", "Home", "Atelier", "Works", "Collective", "Möbler", "Design"];
  const plans = ["trial", "studio", "studio", "operator", "operator", "enterprise"] as const;
  const regions = ["eu-west-1", "eu-west-2", "eu-west-2", "us-east-1", "ap-southeast-2"] as const;

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
    // Trials pay nothing; everyone else pays per seat with a plan floor.
    const perSeat = plan === "studio" ? 29 : plan === "operator" ? 39 : 55;
    const mrr = plan === "trial" ? 0 : seats * perSeat + (plan === "enterprise" ? 1200 : 0);
    // Health skews high — a fleet where half the tenants are failing is not a
    // fleet anyone is still operating.
    const health = Math.min(99, Math.max(18, Math.round(58 + next() * 46 - (plan === "trial" ? 22 : 0))));

    out.push({ slug, name, plan, region: pick(regions), health, mrr, seats, renewDays: 10 + Math.floor(next() * 340) });
  }
  return out;
}

const AURELIUS_BRANDS = [
  { slug: "aurelius-home", name: "Aurelius Home", initials: "AH", segment: "Retail", location: "London", agentName: "Margot", isLive: true },
  { slug: "aurelius-trade", name: "Aurelius Trade", initials: "AT", segment: "Trade", location: "Manchester", agentName: "Bennett", isLive: true },
  { slug: "lindholm", name: "Lindholm", initials: "LH", segment: "Retail", location: "Stockholm", agentName: "Sten", isLive: true },
  { slug: "casa-verde", name: "Casa Verde", initials: "CV", segment: "Trade", location: "Lisbon", agentName: null, isLive: false },
] as const;

const PEOPLE = [
  { email: "priya@aureliusgroup.com", name: "Priya Chandrasekaran", role: "owner", allBrands: true, brands: [], lastActiveMins: 12 },
  { email: "dania@aureliusgroup.com", name: "Dania Rahman", role: "manager", allBrands: false, brands: ["aurelius-home"], lastActiveMins: 0 },
  { email: "joseph@aureliusgroup.com", name: "Joseph Okafor", role: "manager", allBrands: false, brands: ["aurelius-trade"], lastActiveMins: 3 },
  { email: "anna@aureliusgroup.com", name: "Anna Lindberg", role: "agent", allBrands: false, brands: ["aurelius-home", "lindholm"], lastActiveMins: 0 },
  { email: "ravi@aureliusgroup.com", name: "Ravi Mehta", role: "agent", allBrands: false, brands: ["aurelius-home"], lastActiveMins: 42 },
  { email: "marta@aureliusgroup.com", name: "Marta Nowak", role: "agent", allBrands: false, brands: ["lindholm"], lastActiveMins: 8 },
  { email: "tobias@aureliusgroup.com", name: "Tobias Fenwick", role: "analyst", allBrands: true, brands: [], lastActiveMins: 60 },
  { email: "elena@casaverde.pt", name: "Elena Moretti", role: "admin", allBrands: false, brands: ["casa-verde"], invited: true },
] as const;

/* ─── Customers of Aurelius Home ───────────────────────────────────────── */

type Sig = Partial<Record<(typeof AXES)[number]["key"], number>>;

const CUSTOMERS: {
  ref: string;
  name: string;
  segment: string;
  tier: string;
  location: string;
  ltv: number;
  owner: string | null;
  sinceDays: number;
  email?: string;
  phone?: string;
  signals: Sig;
  sentimentDisplay: string;
}[] = [
  { ref: "AH-CU-40912", name: "Marguerite Okonkwo", segment: "Retail", tier: "Tier 1", location: "Hackney, London E8", ltv: 14280, owner: null, sinceDays: 2380, email: "m.okonkwo@fastmail.com", phone: "+44 7700 900 118",
    signals: { churn_risk: 84, revenue_ltv: 92, sentiment: 34, escalation_likelihood: 77, engagement: 48, payment_reliability: 96, cost_to_serve: 71, advocacy_nps: 22, contract_tier: 90, expansion_potential: 61, risk_flags: 4 }, sentimentDisplay: "−0.32" },
  { ref: "AH-CU-40913", name: "Pemberton Interiors", segment: "Trade", tier: "14 seats", location: "Manchester", ltv: 96500, owner: "J. Okafor", sinceDays: 1200,
    signals: { churn_risk: 71, revenue_ltv: 96, sentiment: 41, escalation_likelihood: 68, payment_reliability: 44, contract_tier: 80, cost_to_serve: 62, advocacy_nps: 40, engagement: 70, expansion_potential: 55, risk_flags: 30 }, sentimentDisplay: "−0.18" },
  { ref: "AH-CU-40914", name: "Sofia Lindqvist", segment: "Retail", tier: "Tier 2", location: "Stockholm", ltv: 3940, owner: null, sinceDays: 640,
    signals: { churn_risk: 66, revenue_ltv: 48, sentiment: 29, escalation_likelihood: 72, payment_reliability: 88, contract_tier: 50, cost_to_serve: 68, advocacy_nps: 35, engagement: 52, expansion_potential: 30, risk_flags: 12 }, sentimentDisplay: "−0.41" },
  { ref: "AH-CU-40915", name: "Casa Verde Ltd", segment: "Trade", tier: "6 seats", location: "Lisbon", ltv: 41200, owner: null, sinceDays: 420,
    signals: { churn_risk: 22, revenue_ltv: 84, sentiment: 72, escalation_likelihood: 24, payment_reliability: 92, contract_tier: 60, cost_to_serve: 38, advocacy_nps: 70, engagement: 88, expansion_potential: 86, risk_flags: 4 }, sentimentDisplay: "+0.44" },
  { ref: "AH-CU-40916", name: "Halvard Bruun", segment: "Retail", tier: "Tier 1", location: "Oslo", ltv: 9110, owner: "R. Mehta", sinceDays: 1500,
    signals: { churn_risk: 39, revenue_ltv: 70, sentiment: 56, escalation_likelihood: 30, payment_reliability: 90, contract_tier: 85, cost_to_serve: 44, advocacy_nps: 20, engagement: 50, expansion_potential: 40, risk_flags: 6 }, sentimentDisplay: "+0.12" },
  { ref: "AH-CU-40917", name: "Odile Marchetti", segment: "Retail", tier: "Tier 3", location: "Lyon", ltv: 1260, owner: "R. Mehta", sinceDays: 300,
    signals: { churn_risk: 58, revenue_ltv: 20, sentiment: 52, escalation_likelihood: 40, payment_reliability: 28, contract_tier: 25, cost_to_serve: 55, advocacy_nps: 48, engagement: 34, expansion_potential: 18, risk_flags: 40 }, sentimentDisplay: "+0.05" },
  { ref: "AH-CU-40918", name: "Thandiwe Vasquez", segment: "Retail", tier: "Tier 2", location: "Bristol", ltv: 6730, owner: "AI only", sinceDays: 800,
    signals: { churn_risk: 31, revenue_ltv: 60, sentiment: 68, escalation_likelihood: 28, payment_reliability: 94, contract_tier: 50, cost_to_serve: 36, advocacy_nps: 62, engagement: 66, expansion_potential: 44, risk_flags: 5 }, sentimentDisplay: "+0.36" },
  { ref: "AH-CU-40919", name: "Northmoor Estates", segment: "Trade", tier: "31 seats", location: "Leeds", ltv: 188400, owner: "J. Okafor", sinceDays: 1900,
    signals: { churn_risk: 18, revenue_ltv: 99, sentiment: 79, escalation_likelihood: 16, payment_reliability: 98, contract_tier: 95, cost_to_serve: 30, advocacy_nps: 80, engagement: 82, expansion_potential: 70, risk_flags: 2 }, sentimentDisplay: "+0.58" },
  { ref: "AH-CU-40920", name: "Ines Ferreira", segment: "Retail", tier: "Tier 2", location: "Porto", ltv: 2480, owner: "AI only", sinceDays: 500,
    signals: { churn_risk: 26, revenue_ltv: 34, sentiment: 81, escalation_likelihood: 18, payment_reliability: 90, contract_tier: 45, cost_to_serve: 28, advocacy_nps: 76, engagement: 60, expansion_potential: 26, risk_flags: 3 }, sentimentDisplay: "+0.62" },
  { ref: "AH-CU-40921", name: "Kessel & Co", segment: "Trade", tier: "9 seats", location: "Hamburg", ltv: 54900, owner: "A. Lindberg", sinceDays: 1100,
    signals: { churn_risk: 14, revenue_ltv: 90, sentiment: 86, escalation_likelihood: 12, payment_reliability: 96, contract_tier: 75, cost_to_serve: 26, advocacy_nps: 88, engagement: 78, expansion_potential: 64, risk_flags: 1 }, sentimentDisplay: "+0.71" },
  { ref: "AH-CU-40922", name: "Bartholomew Nkemdirim", segment: "Retail", tier: "Tier 1", location: "Dublin", ltv: 11900, owner: "AI only", sinceDays: 2000,
    signals: { churn_risk: 12, revenue_ltv: 74, sentiment: 83, escalation_likelihood: 10, payment_reliability: 97, contract_tier: 85, cost_to_serve: 20, advocacy_nps: 74, engagement: 18, expansion_potential: 48, risk_flags: 1 }, sentimentDisplay: "+0.66" },
  { ref: "AH-CU-40923", name: "Rowan Ashby-Hale", segment: "Retail", tier: "Tier 3", location: "Cardiff", ltv: 640, owner: "AI only", sinceDays: 200,
    signals: { churn_risk: 9, revenue_ltv: 12, sentiment: 74, escalation_likelihood: 14, payment_reliability: 86, contract_tier: 20, cost_to_serve: 22, advocacy_nps: 66, engagement: 24, expansion_potential: 10, risk_flags: 2 }, sentimentDisplay: "+0.49" },
];

/* ─── Customers of the other two live brands ───────────────────────────── */

/**
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
  owner: string | null;
  sinceDays: number;
  signals: Sig;
}[] = [
  { brand: "aurelius-trade", ref: "AT-CU-2201", name: "Redgrave Contracts", segment: "Trade", tier: "22 seats", location: "Manchester", ltv: 142000, owner: "J. Okafor", sinceDays: 1450,
    signals: { churn_risk: 62, revenue_ltv: 94, contract_tier: 88, sentiment: 44, payment_reliability: 58, escalation_likelihood: 61, cost_to_serve: 66, advocacy_nps: 38, engagement: 74, expansion_potential: 72, risk_flags: 22 } },
  { brand: "aurelius-trade", ref: "AT-CU-2202", name: "Whitlock & Bray", segment: "Trade", tier: "8 seats", location: "Birmingham", ltv: 38900, owner: "J. Okafor", sinceDays: 700,
    signals: { churn_risk: 28, revenue_ltv: 62, contract_tier: 55, sentiment: 74, payment_reliability: 91, escalation_likelihood: 22, cost_to_serve: 34, advocacy_nps: 72, engagement: 68, expansion_potential: 48, risk_flags: 4 } },
  { brand: "aurelius-trade", ref: "AT-CU-2203", name: "Fitzgerald Joinery", segment: "Trade", tier: "4 seats", location: "Glasgow", ltv: 12400, owner: null, sinceDays: 260,
    signals: { churn_risk: 74, revenue_ltv: 38, contract_tier: 30, sentiment: 31, payment_reliability: 36, escalation_likelihood: 70, cost_to_serve: 72, advocacy_nps: 26, engagement: 28, expansion_potential: 20, risk_flags: 46 } },
  { brand: "aurelius-trade", ref: "AT-CU-2204", name: "Orrell Developments", segment: "Trade", tier: "16 seats", location: "Liverpool", ltv: 88600, owner: "A. Lindberg", sinceDays: 980,
    signals: { churn_risk: 20, revenue_ltv: 82, contract_tier: 78, sentiment: 80, payment_reliability: 95, escalation_likelihood: 15, cost_to_serve: 28, advocacy_nps: 84, engagement: 80, expansion_potential: 66, risk_flags: 2 } },
  { brand: "lindholm", ref: "LH-CU-5501", name: "Annika Bergström", segment: "Retail", tier: "Tier 1", location: "Stockholm", ltv: 8600, owner: "M. Nowak", sinceDays: 1100,
    signals: { churn_risk: 55, revenue_ltv: 66, contract_tier: 70, sentiment: 40, payment_reliability: 88, escalation_likelihood: 52, cost_to_serve: 48, advocacy_nps: 44, engagement: 40, expansion_potential: 36, risk_flags: 8 } },
  { brand: "lindholm", ref: "LH-CU-5502", name: "Petter Hallström", segment: "Retail", tier: "Tier 2", location: "Göteborg", ltv: 3100, owner: "AI only", sinceDays: 420,
    signals: { churn_risk: 24, revenue_ltv: 32, contract_tier: 40, sentiment: 78, payment_reliability: 92, escalation_likelihood: 18, cost_to_serve: 26, advocacy_nps: 74, engagement: 62, expansion_potential: 24, risk_flags: 3 } },
  { brand: "lindholm", ref: "LH-CU-5503", name: "Solveig Aune", segment: "Retail", tier: "Tier 1", location: "Oslo", ltv: 15200, owner: "M. Nowak", sinceDays: 1700,
    signals: { churn_risk: 68, revenue_ltv: 88, contract_tier: 86, sentiment: 36, payment_reliability: 94, escalation_likelihood: 64, cost_to_serve: 58, advocacy_nps: 30, engagement: 44, expansion_potential: 52, risk_flags: 6 } },
];

/* ─── The customer record Corva mirrors from other systems ─────────────── */

/**
 * Orders, invoices and tickets that live in Shopify, Stripe and the helpdesk.
 * Corva does not own them; it mirrors them so the agent can answer "where is
 * my order" without a person going to look.
 */
const RECORDS: { ref: string; kind: string; id: string; label: string; status: string; amount: number | null; source: string; daysAgo: number }[] = [
  { ref: "AH-CU-40912", kind: "order", id: "AH-88213", label: "Marlow 3-seat sofa · Ink", status: "Rescheduled ×3", amount: 1840, source: "Shopify", daysAgo: 34 },
  { ref: "AH-CU-40912", kind: "order", id: "AH-84990", label: "Ellery armchair · Ochre", status: "Delivered", amount: 620, source: "Shopify", daysAgo: 210 },
  { ref: "AH-CU-40912", kind: "invoice", id: "IN-20411", label: "Delivery + installation", status: "Paid", amount: 140, source: "Stripe", daysAgo: 34 },
  { ref: "AH-CU-40912", kind: "ticket", id: "ZD-9912", label: "Missed delivery window, second occurrence", status: "Closed", amount: null, source: "Zendesk", daysAgo: 19 },
  { ref: "AH-CU-40912", kind: "delivery", id: "DL-55120", label: "Booked · Thursday, morning slot", status: "Scheduled", amount: null, source: "Courier feed", daysAgo: -3 },
  { ref: "AH-CU-40913", kind: "subscription", id: "SUB-4410", label: "Trade account · 14 seats", status: "Active", amount: 406, source: "Stripe", daysAgo: 1200 },
  { ref: "AH-CU-40913", kind: "invoice", id: "IN-20988", label: "March trade invoice", status: "Disputed", amount: 8410, source: "Stripe", daysAgo: 12 },
  { ref: "AH-CU-40913", kind: "order", id: "AT-31002", label: "Contract seating · 40 units", status: "In production", amount: 22400, source: "Shopify", daysAgo: 26 },
  { ref: "AH-CU-40914", kind: "order", id: "AH-89004", label: "Lindholm bed frame · Oak", status: "Delivered", amount: 940, source: "Shopify", daysAgo: 61 },
  { ref: "AH-CU-40914", kind: "ticket", id: "ZD-9977", label: "Fabric care question", status: "Open", amount: null, source: "Zendesk", daysAgo: 4 },
  { ref: "AH-CU-40919", kind: "subscription", id: "SUB-3301", label: "Trade account · 31 seats", status: "Active", amount: 899, source: "Stripe", daysAgo: 1900 },
  { ref: "AH-CU-40921", kind: "subscription", id: "SUB-3399", label: "Trade account · 9 seats", status: "Active", amount: 261, source: "Stripe", daysAgo: 1100 },
  { ref: "AH-CU-40922", kind: "order", id: "AH-90112", label: "Halden dining table", status: "Delivered", amount: 1290, source: "Shopify", daysAgo: 96 },
  { ref: "AH-CU-40917", kind: "invoice", id: "IN-21044", label: "February statement", status: "Overdue", amount: 210, source: "Stripe", daysAgo: 41 },
];

/** Where a customer's contract renews, for the renewal-window rules. */
const RENEWALS: Record<string, number> = {
  "AH-CU-40913": 18,
  "AH-CU-40919": 240,
  "AH-CU-40921": 26,
  "AH-CU-40915": 120,
};

const CONSENTS: { ref: string; kind: string; granted: boolean; detail: string }[] = [
  { ref: "AH-CU-40912", kind: "call_recording", granted: true, detail: "Verbal, recorded 8 Mar" },
  { ref: "AH-CU-40912", kind: "marketing", granted: false, detail: "Withdrawn via preference centre, Jan" },
  { ref: "AH-CU-40912", kind: "ai_training", granted: false, detail: "Org default — transcripts stay in-tenant" },
  { ref: "AH-CU-40912", kind: "data_sharing", granted: false, detail: "Never asked" },
  { ref: "AH-CU-40913", kind: "call_recording", granted: true, detail: "Contract clause 11.2" },
  { ref: "AH-CU-40913", kind: "marketing", granted: true, detail: "Trade newsletter, double opt-in" },
  { ref: "AH-CU-40919", kind: "call_recording", granted: true, detail: "Contract clause 11.2" },
  { ref: "AH-CU-40919", kind: "marketing", granted: true, detail: "Trade newsletter, double opt-in" },
];

const NOTES: { ref: string; author: string; body: string; pinned: boolean; daysAgo: number }[] = [
  { ref: "AH-CU-40912", author: "D. Rahman", body: "Third reschedule. If this slips again we owe a fixed slot and the £50 credit, not another window — do not let the AI offer a window.", pinned: true, daysAgo: 2 },
  { ref: "AH-CU-40912", author: "R. Mehta", body: "Called back to confirm Thursday morning. Calm, but said plainly this is the last time.", pinned: false, daysAgo: 1 },
  { ref: "AH-CU-40913", author: "J. Okafor", body: "Invoice dispute is a genuine duplicate line from the March migration. Finance is issuing a credit note; do not argue the amount.", pinned: true, daysAgo: 3 },
];

/* ─── Knowledge sources ────────────────────────────────────────────────── */

const SOURCES = [
  { name: "Notion · Customer Ops", kind: "notion", status: "synced", docCount: 6, syncedMins: 120, error: null },
  { name: "Zendesk macros", kind: "zendesk", status: "synced", docCount: 2, syncedMins: 360, error: null },
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
  { key: "telephony", label: "Telephony", provider: "Twilio", state: "degraded", note: "Carrier route degraded in eu-west-2", latencyMs: 2900 },
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
  { org: "northmoor-estates", kind: "risk", body: "Containment fell 11 points after they imported 300 Zendesk macros as documents. Half contradict their own policy. Offered a cleanup session; no reply in nine days.", daysAgo: 3 },
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
      { anchor: "§1", content: "Aurelius Home commits to a named delivery day for every order over £500. Premier customers receive a four-hour arrival window confirmed the evening before." },
      { anchor: "§3.2", content: "Where a delivery has been rescheduled by Aurelius Home two or more times, the customer qualifies for a goodwill credit. The agent may apply up to £50 without approval. A third failure additionally entitles the customer to a fixed morning or afternoon slot rather than a window." },
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
      { anchor: "Installation", content: "Standard installation is £85 for a single room and £140 for multi-room. The fee covers assembly, levelling and packaging removal." },
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
      { anchor: "Partial", content: "Partial refunds up to £120 may be issued by an agent where goods are damaged on arrival. Note: this section is in tension with the fee schedule on who may authorise a refund above £120." },
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
  "You are Margot, answering the phone for Aurelius Home, a British furniture retailer. Be direct and warm; never bubbly. Use the customer's name once, at the start. Never apologise twice for the same thing — fix it instead. If you don't know, say so and get a human. Never quote a price or a date you cannot see in the record.";

const AUTHORITY = [
  { action: "goodwill_credit", label: "Goodwill credit", ceiling: 50, blocked: false, escalateTo: "manager" },
  { action: "reschedule_delivery", label: "Reschedule delivery", ceiling: null, blocked: false, escalateTo: null },
  { action: "partial_refund", label: "Partial refund", ceiling: 120, blocked: false, escalateTo: "manager" },
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
  { name: "Trade renewal window", effect: 10, condition: { all: [{ field: "segment", op: "eq", value: "Trade" }, { field: "renewal_days", op: "lte", value: 30 }] }, actions: [{ kind: "assign_owner" }], author: "J. Okafor", days: 30 },
  { name: "Third service failure", effect: 18, condition: { all: [{ field: "service_failures_90d", op: "gte", value: 3 }] }, actions: [{ kind: "force_human" }], author: "D. Rahman", days: 37 },
  { name: "Silent VIP", effect: 6, condition: { all: [{ field: "ltv_pence", op: "gte", value: 1000000 }, { field: "days_since_contact", op: "gte", value: 60 }] }, actions: [{ kind: "create_task", queue: "outreach" }], author: "A. Lindberg", days: 46 },
  { name: "Chronic low-value complainer", effect: -12, condition: { all: [{ field: "contacts_30d", op: "gte", value: 8 }, { field: "ltv_pence", op: "lt", value: 50000 }] }, actions: [{ kind: "keep_with_ai" }], author: "D. Rahman", days: 63 },
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
  { name: "Trade accounts", query: { segment: "Trade" }, owner: "J. Okafor" },
  { name: "Silent VIPs", query: { flag: "healthy", sort: "value:desc" }, owner: "A. Lindberg" },
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
        mrrPence: pence(o.mrr),
        seatCount: o.seats,
        renewsAt: "renews" in o && o.renews ? new Date(o.renews) : null,
      })),
      ...fleet.map((o) => ({
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        region: o.region,
        healthScore: o.health,
        mrrPence: pence(o.mrr),
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
        owner: c.owner,
        customerSince: daysAgo(c.sinceDays),
        renewsAt: RENEWALS[c.ref] ? daysAgo(-RENEWALS[c.ref]) : null,
        ltvPence: pence(c.ltv),
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
        owner: c.owner,
        customerSince: daysAgo(c.sinceDays),
        ltvPence: pence(c.ltv),
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
      amountPence: r.amount === null ? null : pence(r.amount),
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
      { brandId: home.id, version: 10, persona: PERSONA, tone: { warmth: 6, brevity: 8, formality: 4, persistence: 3 }, status: "retired", authorName: "J. Okafor", notes: "Blocked discounting as a retention tool after two bad calls.", publishedAt: daysAgo(32) },
      { brandId: home.id, version: 11, persona: PERSONA, tone: { warmth: 6, brevity: 8, formality: 4, persistence: 3 }, status: "live", authorName: "D. Rahman", notes: "Raised goodwill ceiling to £50; added Premier promise wording.", publishedAt: daysAgo(13) },
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
        ceilingPence: a.ceiling === null ? null : pence(a.ceiling),
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
    { brandId: home.id, kind: "phone", address: "+44 20 7946 0102", detail: "AI answers in 1.4s", state: "live" },
    { brandId: home.id, kind: "whatsapp", address: "+44 20 7946 0102", detail: "Business number verified", state: "live" },
    { brandId: home.id, kind: "web_chat", address: "aureliushome.co.uk", detail: "Embedded site widget", state: "live" },
    { brandId: home.id, kind: "email", address: "help@aureliushome.co.uk", detail: "AI drafts only", state: "drafts_only" },
    { brandId: home.id, kind: "sms", address: null, detail: null, state: "not_connected" },
  ]);

  await db.insert(s.integrations).values([
    { orgId: aurelius.id, name: "Shopify", purpose: "Orders, refunds, customers", status: "Synced 2m ago", healthy: true, lastSyncedAt: minsAgo(2) },
    { orgId: aurelius.id, name: "Stripe", purpose: "Payments, failed charges, credits", status: "Synced 5m ago", healthy: true, lastSyncedAt: minsAgo(5) },
    { orgId: aurelius.id, name: "Twilio", purpose: "Helpline numbers and SMS", status: "Connected", healthy: true },
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
        // Roughly 11p of model and telephony cost per AI minute.
        costPence: Math.round(total * 3.4 * 11),
      });
    }

    // Twelve months of recurring revenue, growing into today's figure.
    for (let m = 11; m >= 0; m--) {
      const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 1));
      const ramp = 1 - m * 0.035;
      mrr.push({
        orgId: org.id,
        month,
        mrrPence: Math.max(0, Math.round(org.mrrPence * ramp)),
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
    { title: "Voice latency in eu-west-2", severity: "Sev 2", regionKey: "eu-west-2", note: "Carrier route degraded. Failover staged; 14 companies affected, 3 past their SLA threshold.", startedAt: minsAgo(42), affectedOrgCount: 14 },
    { title: "Retrieval index lag", severity: "Sev 3", regionKey: "eu-west-1", note: "New documents took up to 9 minutes to become answerable. No wrong answers served.", startedAt: daysAgo(5), resolvedAt: daysAgo(5), affectedOrgCount: 61 },
    { title: "Dashboard read timeouts", severity: "Sev 3", regionKey: "eu-west-2", note: "Analytics queries only; calls unaffected.", startedAt: daysAgo(13), resolvedAt: daysAgo(13), affectedOrgCount: 48 },
    { title: "WhatsApp webhook backlog", severity: "Sev 2", regionKey: null, note: "Messages delivered late. 22 companies notified, credits applied automatically.", startedAt: daysAgo(23), resolvedAt: daysAgo(23), affectedOrgCount: 22 },
    { title: "Model provider rate limit", severity: "Sev 3", regionKey: null, note: "Fell back to the secondary provider; containment dipped 4 points for the window.", startedAt: daysAgo(32), resolvedAt: daysAgo(32), affectedOrgCount: 148 },
  ]);

  const incidentRows = await db.select().from(s.incidents);
  const byTitle = new Map(incidentRows.map((i) => [i.title, i]));
  const voice = byTitle.get("Voice latency in eu-west-2")!;
  await db.insert(s.incidentUpdates).values([
    { incidentId: voice.id, stage: "investigating", body: "Voice p95 in eu-west-2 crossed 2.5s. Paging the telephony on-call.", authorName: "R. Vance", at: minsAgo(42) },
    { incidentId: voice.id, stage: "identified", body: "Carrier route degraded upstream of Twilio. Not our path; failover to the secondary carrier is staged and needs a go.", authorName: "R. Vance", at: minsAgo(28) },
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
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("dania@aureliusgroup.com")!.id, actorName: "D. Rahman", action: "authority.ceiling_raised", target: "goodwill_credit", meta: { to: "£50" }, at: minsAgo(120) },
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("joseph@aureliusgroup.com")!.id, actorName: "J. Okafor", action: "credit_note.approved", target: "£8,410", meta: {}, at: minsAgo(240) },
    { orgId: aurelius.id, brandId: home.id, actorType: "user", actorId: memberByEmail.get("anna@aureliusgroup.com")!.id, actorName: "A. Lindberg", action: "document.published", target: "Care guide · Lindholm", meta: {}, at: daysAgo(1) },
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
