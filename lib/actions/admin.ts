"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { isTier, planFor } from "@/lib/billing/plans";
import { createBusiness, type OnboardingInput } from "@/lib/business/onboard";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * What Corva's own admins can do to a business from outside it: put it on a
 * plan, give it more time, add one on someone's behalf, remove one. Every
 * action checks the allowlist again — a server action is a public endpoint.
 */

const DAY = 864e5;

/** Put a business on a plan for a number of days from now — a comp, an extension, an invoice paid by bank transfer. */
export async function setPlan(orgSlug: string, tier: string, days: number) {
  const admin = await requireAdmin();
  if (!isTier(tier)) throw new Error("Unknown plan.");
  const length = Math.round(Number(days));
  if (!Number.isFinite(length) || length < 1 || length > 730) throw new Error("Between 1 and 730 days.");
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, orgSlug)).limit(1);
  if (!org) throw new Error("No such business.");

  const now = new Date();
  // Keeping the plan only moves the end; changing it starts a fresh period.
  const samePlan = org.tier === tier;
  await db
    .update(s.organizations)
    .set({ tier, periodStart: samePlan ? org.periodStart : now, periodEnd: new Date(now.getTime() + length * DAY) })
    .where(eq(s.organizations.id, org.id));
  await db.insert(s.auditLog).values({
    orgId: org.id,
    actorType: "staff",
    actorId: admin.email,
    actorName: `${admin.name} (Corva)`,
    action: "plan.set",
    target: planFor(tier).name,
    meta: { from: org.tier, to: tier, days: length },
  });
  revalidatePath("/admin", "layout");
}

/** Add a business for someone: they get an invitation to the Owner seat by email. */
export async function addBusiness(input: OnboardingInput) {
  const admin = await requireAdmin();
  const result = await createBusiness({ ...input, phoneNumber: "", team: input.team ?? "" }, { staffId: admin.email, name: admin.name });
  revalidatePath("/admin", "layout");
  redirect(`/admin/businesses/${result.orgSlug}`);
}

/** Remove a business and everything in it. The name has to be typed back. */
export async function removeBusiness(orgSlug: string, confirmName: string) {
  await requireAdmin();
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, orgSlug)).limit(1);
  if (!org) throw new Error("No such business.");
  if (confirmName.trim().toLowerCase() !== org.name.trim().toLowerCase()) throw new Error(`Type "${org.name}" to confirm.`);
  await db.delete(s.organizations).where(eq(s.organizations.id, org.id));
  revalidatePath("/admin", "layout");
  redirect("/admin");
}

export async function setDemoStatus(id: string, status: string) {
  await requireAdmin();
  if (!["new", "contacted", "closed"].includes(status)) throw new Error("Unknown status.");
  await db.update(s.demoRequests).set({ status }).where(eq(s.demoRequests.id, id));
  revalidatePath("/admin/demo-requests");
}
