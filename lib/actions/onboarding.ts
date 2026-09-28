"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/context";
import { enterAsBusiness } from "@/lib/auth/enter";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "@/lib/business/industries";
import { createBusiness, type OnboardingInput, type OnboardingResult } from "@/lib/business/onboard";

export type { OnboardingResult };

/** Add a business. Staff only; the work is in lib/business/onboard.ts. */
export async function onboardBusiness(input: OnboardingInput): Promise<OnboardingResult> {
  const { staff } = await requireStaff();
  const result = await createBusiness(input, staff);
  revalidatePath("/operator");
  revalidatePath("/operator/onboarding");
  return result;
}

/**
 * Open a business's console as its Owner. Demo mode only — see enterAsBusiness.
 */
export async function enterBusiness(orgSlug: string) {
  await requireStaff();
  await enterAsBusiness({ orgSlug });
  revalidatePath("/app", "layout");
  redirect("/app");
}

/** Businesses added recently, with whether each can actually take a call. */
export async function recentlyOnboarded(limit = 10) {
  await requireStaff();

  const rows = await db
    .select({
      org: s.organizations,
      people: sql<number>`count(distinct ${s.memberships.id})::int`,
      liveBrands: sql<number>`count(distinct ${s.brands.id}) filter (where ${s.brands.isLive})::int`,
      industry: sql<string | null>`min(${s.brands.industry})`,
      phone: sql<string | null>`min(${s.channels.address}) filter (where ${s.channels.kind} = 'phone')`,
    })
    .from(s.organizations)
    .leftJoin(s.brands, eq(s.brands.orgId, s.organizations.id))
    .leftJoin(s.memberships, eq(s.memberships.orgId, s.organizations.id))
    .leftJoin(s.channels, eq(s.channels.brandId, s.brands.id))
    .groupBy(s.organizations.id)
    .orderBy(sql`${s.organizations.createdAt} desc`)
    .limit(limit);

  return rows.map((r) => ({
    slug: r.org.slug,
    name: r.org.name,
    industry: industryFor(r.industry).label,
    phone: r.phone,
    people: r.people,
    live: r.liveBrands > 0,
    createdAt: r.org.createdAt,
  }));
}
