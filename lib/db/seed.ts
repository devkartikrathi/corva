/**
 * Seeds the database with the world the designs describe.
 *
 * Everything here is domain data, not presentation data: money is pence,
 * scores are 0–100, and the derived values the screens show (bar widths, tag
 * colours, blended priority) are computed from these rows rather than stored.
 *
 * Idempotent — it truncates the tenant tables first, so it is safe to re-run.
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
  { key: "multi_brand", label: "Multi-brand workspaces", note: "Generally available", defaultOn: true },
  { key: "custom_axes_sql", label: "Custom scoring axes (SQL)", note: "Beta · 24 companies", defaultOn: false },
  { key: "private_fine_tuning", label: "Private fine-tuning", note: "Enterprise only", defaultOn: false },
  { key: "voice_43_canary", label: "corva-voice-4.3 canary", note: "Rolling out", defaultOn: false },
  { key: "proactive_outbound", label: "Proactive outbound calls", note: "Alpha · needs legal sign-off", defaultOn: false },
  { key: "agent_copilot", label: "Agent copilot in the console", note: "Internal only", defaultOn: false },
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

const SEGMENTS = [
  { name: "High priority", count: 38, owner: "shared" },
  { name: "Churn watch", count: 214, owner: "D. Rahman" },
  { name: "Trade accounts", count: 906, owner: "J. Okafor" },
  { name: "Silent VIPs", count: 47, owner: "A. Lindberg" },
  { name: "Payment risk", count: 68, owner: "Finance" },
  { name: "Expansion candidates", count: 129, owner: "Sales" },
] as const;

/* ─── Seed ─────────────────────────────────────────────────────────────── */

async function main() {
  console.log("Clearing…");
  await db.execute(sql`
    TRUNCATE TABLE
      ${s.organizations}, ${s.staff}, ${s.scoringAxes}, ${s.regions}, ${s.featureFlags}
    RESTART IDENTITY CASCADE
  `);

  console.log("Reference data…");
  await db.insert(s.scoringAxes).values(
    AXES.map((a) => ({ key: a.key, label: a.label, source: a.source, inverted: a.inverted })),
  );
  await db.insert(s.regions).values(REGIONS.map((r) => ({ ...r })));
  await db.insert(s.featureFlags).values(FLAGS.map((f) => ({ ...f })));

  const [operator] = await db
    .insert(s.staff)
    .values({ clerkUserId: "staff_seed_operator", email: "you@corva.systems", name: "Corva Operator", isAdmin: true })
    .returning();

  console.log("Organizations…");
  const orgRows = await db
    .insert(s.organizations)
    .values(
      ORGS.map((o) => ({
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        region: o.region,
        healthScore: o.health,
        mrrPence: pence(o.mrr),
        seatCount: o.seats,
        renewsAt: "renews" in o && o.renews ? new Date(o.renews) : null,
      })),
    )
    .returning();
  const orgBySlug = new Map(orgRows.map((o) => [o.slug, o]));
  const aurelius = orgBySlug.get("aurelius-group")!;

  // Feature flags per tenant, matching what the operator console shows.
  await db.insert(s.orgFeatureFlags).values(
    FLAGS.map((f) => ({ orgId: aurelius.id, flagKey: f.key, enabled: f.defaultOn || f.key === "custom_axes_sql" || f.key === "private_fine_tuning" })),
  );

  console.log("Brands…");
  const brandRows = await db
    .insert(s.brands)
    .values(AURELIUS_BRANDS.map((b) => ({ ...b, orgId: aurelius.id })))
    .returning();
  const brandBySlug = new Map(brandRows.map((b) => [b.slug, b]));
  const home = brandBySlug.get("aurelius-home")!;

  console.log("People…");
  const memberRows = await db
    .insert(s.memberships)
    .values(
      PEOPLE.map((p) => ({
        orgId: aurelius.id,
        // Real Clerk ids are attached on first sign-in; see lib/auth/link.ts.
        clerkUserId: `seed:${p.email}`,
        email: p.email,
        name: p.name,
        role: p.role,
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
  await db.insert(s.brandAxisWeights).values(
    AXES.map((a) => ({ brandId: home.id, axisKey: a.key, weight: a.weight })),
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
      definition: { estimatedCount: seg.count },
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
        ltvPence: pence(c.ltv),
      })),
    )
    .returning();
  const customerByRef = new Map(customerRows.map((c) => [c.externalRef!, c]));

  await db.insert(s.customerSignals).values(
    CUSTOMERS.flatMap((c) =>
      Object.entries(c.signals).map(([axisKey, value]) => ({
        customerId: customerByRef.get(c.ref)!.id,
        axisKey,
        value: value as number,
        display: axisKey === "sentiment" ? c.sentimentDisplay : null,
      })),
    ),
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

  await db.insert(s.knowledgeGaps).values(
    GAPS.map((g) => ({ brandId: home.id, intent: g.intent, hits: g.hits, reason: g.reason })),
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

  console.log("Platform ops…");
  await db.insert(s.incidents).values([
    { title: "Voice latency in eu-west-2", severity: "Sev 2", regionKey: "eu-west-2", note: "Carrier route degraded. Failover staged; 14 companies affected, 3 past their SLA threshold.", startedAt: minsAgo(42), affectedOrgCount: 14 },
    { title: "Retrieval index lag", severity: "Sev 3", regionKey: "eu-west-1", note: "New documents took up to 9 minutes to become answerable. No wrong answers served.", startedAt: daysAgo(5), resolvedAt: daysAgo(5), affectedOrgCount: 61 },
    { title: "Dashboard read timeouts", severity: "Sev 3", regionKey: "eu-west-2", note: "Analytics queries only; calls unaffected.", startedAt: daysAgo(13), resolvedAt: daysAgo(13), affectedOrgCount: 48 },
    { title: "WhatsApp webhook backlog", severity: "Sev 2", regionKey: null, note: "Messages delivered late. 22 companies notified, credits applied automatically.", startedAt: daysAgo(23), resolvedAt: daysAgo(23), affectedOrgCount: 22 },
    { title: "Model provider rate limit", severity: "Sev 3", regionKey: null, note: "Fell back to the secondary provider; containment dipped 4 points for the window.", startedAt: daysAgo(32), resolvedAt: daysAgo(32), affectedOrgCount: 148 },
  ]);

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
  console.log(`  brands        ${brandRows.length}`);
  console.log(`  people        ${memberRows.length}`);
  console.log(`  customers     ${customerRows.length}`);
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
