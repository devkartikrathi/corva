"use server";

import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DEFAULT_MODEL_ID, isKnownModel } from "@/lib/agent/models";

/**
 * Onboarding a company.
 *
 * The only place outside the seed that creates an organization, and the start
 * of the chain the whole role model rests on: Corva staff create the company
 * and its first Owner; that Owner invites their managers; managers invite their
 * agents. Nobody can grant a role above their own at any step, so the chain
 * cannot be used to escalate.
 *
 * What is created here is deliberately the minimum a workspace needs to be
 * openable — an organization, one brand, opening hours, a privacy position, and
 * an Owner. Not an agent version, not documents, not channels: those are the
 * tenant's own decisions, and pre-filling them would put words in their mouth
 * that their customers would then hear.
 *
 * The model is the exception, and it is ours rather than theirs. Which model a
 * brand answers on is a question about what we can afford to give them today —
 * the free tier meters requests per model per day across the whole key — and
 * about what they are actually buying: a helpline that reads documents aloud
 * needs less of a model than one that credits accounts. Staff set it here and
 * change it from the account screen; the tenant never sees it.
 */

const PLANS = ["trial", "studio", "operator", "enterprise"] as const;
const REGIONS = ["eu-west-1", "eu-west-2", "us-east-1", "ap-southeast-2"] as const;

/** Mon–Fri 09:00–18:00, Saturday 10:00–16:00, closed Sunday. */
const DEFAULT_HOURS = [
  { weekday: 0, opensMinute: 540, closesMinute: 1080, closed: false },
  { weekday: 1, opensMinute: 540, closesMinute: 1080, closed: false },
  { weekday: 2, opensMinute: 540, closesMinute: 1080, closed: false },
  { weekday: 3, opensMinute: 540, closesMinute: 1080, closed: false },
  { weekday: 4, opensMinute: 540, closesMinute: 1080, closed: false },
  { weekday: 5, opensMinute: 600, closesMinute: 960, closed: false },
  { weekday: 6, opensMinute: 0, closesMinute: 0, closed: true },
];

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "??";

export type OnboardingResult = {
  orgSlug: string;
  orgName: string;
  brandName: string;
  ownerEmail: string;
  inviteToken: string;
};

export async function onboardCompany(input: {
  companyName: string;
  plan: string;
  region: string;
  seats: number;
  brandName: string;
  ownerName: string;
  ownerEmail: string;
  modelId?: string;
}): Promise<OnboardingResult> {
  const { staff } = await requireStaff();

  const companyName = input.companyName.trim();
  const brandName = input.brandName.trim() || companyName;
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim() || ownerEmail.split("@")[0];

  if (!companyName) throw new Error("The company needs a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("That is not an email address.");
  if (!PLANS.includes(input.plan as (typeof PLANS)[number])) throw new Error("Unknown plan.");
  if (!REGIONS.includes(input.region as (typeof REGIONS)[number])) throw new Error("Unknown region.");

  // An unrecognised id is refused rather than quietly defaulted: a workspace
  // that was meant to be on the cheap model and silently is not spends someone
  // else's quota for a week before anyone notices.
  const modelId = input.modelId ?? DEFAULT_MODEL_ID;
  if (!isKnownModel(modelId)) throw new Error("That is not a model we offer.");

  const slug = slugify(companyName);
  if (!slug) throw new Error("That name does not make a usable address.");

  const [clash] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, slug))
    .limit(1);
  if (clash) throw new Error(`A company at "${slug}" already exists.`);

  const seats = Math.max(1, Math.min(1000, Math.round(input.seats || 1)));

  // Trials pay nothing; everyone else is priced per seat with a plan floor.
  const perSeat = input.plan === "studio" ? 249_900 : input.plan === "operator" ? 349_900 : 499_900;
  const mrrPaise = input.plan === "trial" ? 0 : seats * perSeat + (input.plan === "enterprise" ? 99_00_000 : 0);

  const [org] = await db
    .insert(s.organizations)
    .values({
      slug,
      name: companyName,
      plan: input.plan as (typeof PLANS)[number],
      region: input.region,
      seatCount: seats,
      mrrPaise,
      // No health score until the rollup has traffic to judge — a brand-new
      // tenant scored 0 would sit at the top of the "needs attention" list on
      // its first day, which is the opposite of true.
      healthScore: null,
      renewsAt: new Date(Date.now() + 365 * 864e5),
    })
    .returning();

  const [brand] = await db
    .insert(s.brands)
    .values({
      orgId: org.id,
      slug: slugify(brandName) || "main",
      name: brandName,
      initials: initialsOf(brandName),
      modelId,
      isLive: false,
    })
    .returning();

  await db.insert(s.businessHours).values(
    DEFAULT_HOURS.map((h) => ({ brandId: brand.id, ...h })),
  );

  // Retention and redaction default to the cautious answer. A tenant can
  // loosen them; nobody should have to remember to tighten them.
  await db.insert(s.privacySettings).values({
    orgId: org.id,
    retentionDays: 365,
    redactPii: true,
    trainOnTranscripts: false,
    recordCalls: true,
    dataRegion: org.region,
    allowSupportAccess: true,
    updatedByName: staff.name,
  });

  const inviteToken = randomUUID();
  await db.insert(s.memberships).values({
    orgId: org.id,
    clerkUserId: null,
    email: ownerEmail,
    name: ownerName,
    role: "owner",
    status: "invited",
    inviteToken,
    invitedByName: `${staff.name} (Corva)`,
    allBrands: true,
    invitedAt: new Date(),
  });

  // Written to the tenant's own log, so their first Owner can see on day one
  // exactly what Corva did to create the workspace.
  await db.insert(s.auditLog).values({
    orgId: org.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "workspace.created",
    target: companyName,
    meta: { plan: input.plan, region: input.region, seats, owner: ownerEmail, model: modelId },
  });

  revalidatePath("/operator");
  revalidatePath("/operator/onboarding");

  return {
    orgSlug: org.slug,
    orgName: org.name,
    brandName: brand.name,
    ownerEmail,
    inviteToken,
  };
}

/** Companies onboarded recently, with how far each has actually got. */
export async function recentlyOnboarded(limit = 8) {
  await requireStaff();

  const rows = await db
    .select({
      org: s.organizations,
      brands: sql<number>`count(distinct ${s.brands.id})::int`,
      people: sql<number>`count(distinct ${s.memberships.id})::int`,
      pending: sql<number>`count(distinct ${s.memberships.id}) filter (where ${s.memberships.status} = 'invited')::int`,
      liveBrands: sql<number>`count(distinct ${s.brands.id}) filter (where ${s.brands.isLive})::int`,
    })
    .from(s.organizations)
    .leftJoin(s.brands, eq(s.brands.orgId, s.organizations.id))
    .leftJoin(s.memberships, eq(s.memberships.orgId, s.organizations.id))
    .groupBy(s.organizations.id)
    .orderBy(sql`${s.organizations.createdAt} desc`)
    .limit(limit);

  const withDocs = await db
    .select({ orgId: s.brands.orgId, docs: sql<number>`count(*)::int` })
    .from(s.documents)
    .innerJoin(s.brands, eq(s.brands.id, s.documents.brandId))
    .where(eq(s.documents.status, "published"))
    .groupBy(s.brands.orgId);
  const docsBy = new Map(withDocs.map((d) => [d.orgId, d.docs]));

  return rows.map((r) => {
    const docs = docsBy.get(r.org.id) ?? 0;
    // The four things that stand between a new workspace and answering a call.
    const steps = [
      { label: "Owner accepted", done: r.people > r.pending },
      { label: "Documents published", done: docs > 0 },
      { label: "Brand live", done: r.liveBrands > 0 },
      { label: "Team invited", done: r.people > 1 },
    ];
    return {
      slug: r.org.slug,
      name: r.org.name,
      plan: r.org.plan,
      region: r.org.region,
      createdAt: r.org.createdAt,
      brands: r.brands,
      people: r.people,
      pending: r.pending,
      steps,
      complete: steps.filter((x) => x.done).length,
    };
  });
}
