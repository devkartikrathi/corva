/**
 * Demo CRM data for Aurelius Home.
 *
 * The seed predates leads and follow-ups, so the demo workspace opened on an
 * empty pipeline. This adds a believable week: leads at every stage, most of
 * them written by the AI on calls, owned by different people on the team, and
 * follow-ups that are overdue, due today, upcoming, and done — some on time,
 * one late — so Home, Leads, Follow-ups and Team performance all have
 * something true-looking to show.
 *
 * Idempotent in the simplest way: a brand that already has leads is left
 * alone, so this never piles duplicates on top of real test calls.
 *
 *   npm run db:crm
 */
import "./script-env";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Today at hh:mm India time, shifted by `days`. */
function ist(days: number, hh: number, mm = 0) {
  const now = new Date(Date.now() + 330 * 60_000);
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm) - 330 * 60_000;
  return new Date(base + days * DAY);
}

type LeadSeed = {
  name: string;
  phone: string;
  existing?: boolean;
  interest: string;
  rupees: number;
  stage: (typeof s.leadStageEnum.enumValues)[number];
  owner: string;
  source: string;
  ai: boolean;
  ageHours: number;
  lostReason?: string;
  followUps: {
    title: string;
    detail?: string;
    due: Date;
    ai: boolean;
    by?: string;
    done?: { at: Date; outcome?: string };
  }[];
};

const LEADS: LeadSeed[] = [
  {
    name: "Kabir Sethi",
    phone: "+91 98191 40562",
    interest: "3-seater sofa in grey fabric, delivery to Powai",
    rupees: 85_000,
    stage: "new",
    owner: "Meghna Naik",
    source: "phone",
    ai: true,
    ageHours: 2,
    followUps: [
      { title: "Call back with grey fabric swatches and a delivery date", due: ist(0, 16), ai: true },
    ],
  },
  {
    name: "Farah Siddiqui",
    phone: "+91 97690 11834",
    interest: "Bunk bed for two kids, wants to know about safety rails",
    rupees: 38_000,
    stage: "new",
    owner: "Anaya Lamba",
    source: "whatsapp",
    ai: true,
    ageHours: 0.5,
    followUps: [{ title: "Send bunk bed safety specs and rail height", due: ist(1, 11), ai: true }],
  },
  {
    name: "Ishita Kapoor",
    phone: "+91 99870 24415",
    interest: "Teak dining set for 6, needed before Diwali",
    rupees: 1_40_000,
    stage: "contacted",
    owner: "Ravi Mehta",
    source: "phone",
    ai: true,
    ageHours: 30,
    followUps: [
      { title: "Send the teak dining set catalogue on WhatsApp", due: ist(-1, 11), ai: true },
    ],
  },
  {
    name: "Rohan Nadkarni",
    phone: "+91 80500 33418",
    existing: true,
    interest: "Matching coffee table for the sofa he bought in June",
    rupees: 22_000,
    stage: "contacted",
    owner: "Meghna Naik",
    source: "phone",
    ai: true,
    ageHours: 72,
    followUps: [
      {
        title: "Call about coffee table options",
        due: ist(-2, 12),
        ai: true,
        done: { at: ist(-2, 11, 40), outcome: "Sent three options on WhatsApp" },
      },
    ],
  },
  {
    name: "Sundaram Interiors",
    phone: "+91 90040 22910",
    existing: true,
    interest: "Bulk order: 40 office chairs for their new Thane branch",
    rupees: 6_00_000,
    stage: "qualified",
    owner: "Jyoti Okhandiar",
    source: "manual",
    ai: false,
    ageHours: 96,
    followUps: [
      { title: "Share the bulk pricing quote for 40 chairs", due: ist(1, 10), ai: false, by: "Dania Rahman" },
    ],
  },
  {
    name: "Neha Bhat",
    phone: "+91 98330 67120",
    interest: "Wardrobe with custom sliding doors for the master bedroom",
    rupees: 95_000,
    stage: "proposal",
    owner: "Anaya Lamba",
    source: "web_chat",
    ai: true,
    ageHours: 144,
    followUps: [{ title: "Confirm the measurement visit", due: ist(0, 18), ai: false, by: "Anaya Lamba" }],
  },
  {
    name: "Meera Okhale",
    phone: "+91 98200 41187",
    existing: true,
    interest: "Second bedroom set for her daughter's new flat",
    rupees: 1_10_000,
    stage: "won",
    owner: "Ravi Mehta",
    source: "phone",
    ai: true,
    ageHours: 216,
    followUps: [
      {
        title: "Confirm the delivery slot for the bedroom set",
        due: ist(-8, 11),
        ai: true,
        done: { at: ist(-5, 17), outcome: "Delivered Saturday morning" },
      },
    ],
  },
  {
    name: "Priyanka Das",
    phone: "+91 90290 88213",
    interest: "Outdoor furniture for a terrace café (trade account)",
    rupees: 2_60_000,
    stage: "won",
    owner: "Jyoti Okhandiar",
    source: "phone",
    ai: true,
    ageHours: 360,
    followUps: [
      {
        title: "Send trade pricing for outdoor range",
        due: ist(-14, 15),
        ai: true,
        done: { at: ist(-14, 13), outcome: "Order placed the same week" },
      },
    ],
  },
  {
    name: "Arvind Menon",
    phone: "+91 99200 51377",
    interest: "Leather recliner, asked about EMI options",
    rupees: 48_000,
    stage: "lost",
    owner: "Meghna Naik",
    source: "phone",
    ai: true,
    ageHours: 288,
    lostReason: "Bought a cheaper one elsewhere",
    followUps: [
      {
        title: "Call back with EMI options",
        due: ist(-11, 12),
        ai: true,
        done: { at: ist(-11, 11, 30), outcome: "Not interested in EMI after all" },
      },
    ],
  },
];

async function main() {
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, "aurelius-home")).limit(1);
  if (!brand) throw new Error("Run npm run db:seed first — there is no Aurelius Home.");

  // The seed predates industries; Aurelius sells furniture.
  await db
    .update(s.brands)
    .set({ industry: "retail" })
    .where(and(eq(s.brands.orgId, brand.orgId), inArray(s.brands.slug, ["aurelius-home", "aurelius-trade"])));

  const [already] = await db.select({ id: s.leads.id }).from(s.leads).where(eq(s.leads.brandId, brand.id)).limit(1);
  if (already) {
    console.log("Aurelius Home already has leads — leaving them alone.");
    process.exit(0);
  }

  const people = await db.select().from(s.memberships).where(eq(s.memberships.orgId, brand.orgId));
  const byName = new Map(people.map((p) => [p.name, p]));

  for (const l of LEADS) {
    const owner = byName.get(l.owner);
    if (!owner) throw new Error(`No ${l.owner} in Aurelius Group.`);
    const createdAt = new Date(Date.now() - l.ageHours * HOUR);

    let [customer] = await db
      .select()
      .from(s.customers)
      .where(and(eq(s.customers.brandId, brand.id), eq(s.customers.phone, l.phone)))
      .limit(1);
    if (!customer) {
      [customer] = await db
        .insert(s.customers)
        .values({
          brandId: brand.id,
          name: l.name,
          phone: l.phone,
          segment: l.stage === "won" ? "Retail" : "New caller",
          ownerMembershipId: owner.id,
          owner: owner.name,
          customerSince: createdAt,
          ltvPaise: l.stage === "won" ? l.rupees * 100 : 0,
          createdAt,
        })
        .returning();
    }

    const [lead] = await db
      .insert(s.leads)
      .values({
        brandId: brand.id,
        customerId: customer.id,
        name: l.name,
        phone: l.phone,
        interest: l.interest,
        stage: l.stage,
        valuePaise: l.rupees * 100,
        ownerMembershipId: owner.id,
        source: l.source,
        createdByAi: l.ai,
        lostReason: l.lostReason ?? null,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + Math.min(l.ageHours, 24) * HOUR * 0.5),
        stageChangedAt: new Date(createdAt.getTime() + Math.min(l.ageHours, 24) * HOUR * 0.5),
      })
      .returning();

    for (const f of l.followUps) {
      await db.insert(s.followUps).values({
        brandId: brand.id,
        customerId: customer.id,
        leadId: lead.id,
        title: f.title,
        detail: f.detail ?? null,
        dueAt: f.due,
        assigneeMembershipId: owner.id,
        status: f.done ? "done" : "open",
        createdByName: f.ai ? (brand.agentName ?? "The AI") : (f.by ?? owner.name),
        createdByAi: f.ai,
        completedAt: f.done?.at ?? null,
        completedByName: f.done ? owner.name : null,
        outcome: f.done?.outcome ?? null,
        createdAt,
      });
    }
  }

  console.log(`Added ${LEADS.length} leads and their follow-ups to Aurelius Home.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
