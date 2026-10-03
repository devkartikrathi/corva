"use server";

import { and, eq, isNull } from "drizzle-orm";
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

/**
 * Switch "Collected by Corva" on or off for a brand: payment links on Corva's
 * own Razorpay account, for a business with no payment system of its own.
 * Corva's decision, because Corva then holds the business's money.
 */
export async function setCollections(brandId: string, input: { enabled: boolean; feePercent: string; payoutNote: string; routeAccountId: string }) {
  const admin = await requireAdmin();
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
  if (!brand) throw new Error("No such brand.");
  const fee = Number(input.feePercent || "0");
  if (!Number.isFinite(fee) || fee < 0 || fee > 20) throw new Error("The fee is a percentage between 0 and 20.");
  const route = input.routeAccountId.trim();
  if (route && !/^acc_[A-Za-z0-9]{6,}$/.test(route)) throw new Error("A Route account id looks like acc_XXXXXXXX.");
  const values = {
    enabled: input.enabled,
    feeBasisPoints: Math.round(fee * 100),
    payoutNote: input.payoutNote.trim().slice(0, 200) || null,
    routeAccountId: route || null,
    enabledByName: `${admin.name} (Corva)`,
    updatedAt: new Date(),
  };
  await db.insert(s.collectionSettings).values({ brandId, ...values }).onConflictDoUpdate({ target: s.collectionSettings.brandId, set: values });
  await db.insert(s.auditLog).values({
    orgId: brand.orgId,
    brandId,
    actorType: "staff",
    actorId: admin.email,
    actorName: `${admin.name} (Corva)`,
    action: input.enabled ? "collections.enabled" : "collections.disabled",
    target: brand.name,
    meta: { feeBasisPoints: values.feeBasisPoints, routeAccountId: values.routeAccountId },
  });
  revalidatePath("/admin", "layout");
}

/** Record that what Corva collected for a brand has been paid out to it. */
export async function recordPayout(brandId: string, reference: string) {
  const admin = await requireAdmin();
  const ref = reference.trim();
  if (!ref) throw new Error("Give the transfer's reference (UTR or UPI id), so the payout can be traced.");
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
  if (!brand) throw new Error("No such brand.");
  const settled = await db
    .update(s.customerPayments)
    .set({ settledAt: new Date(), settlementRef: ref.slice(0, 120), updatedAt: new Date() })
    .where(and(eq(s.customerPayments.brandId, brandId), eq(s.customerPayments.collectedBy, "corva"), eq(s.customerPayments.status, "paid"), isNull(s.customerPayments.settledAt)))
    .returning({ id: s.customerPayments.id, paid: s.customerPayments.amountPaidPaise, fee: s.customerPayments.feePaise });
  if (!settled.length) throw new Error("Nothing is waiting to be paid out.");
  const owed = settled.reduce((n, p) => n + p.paid - (p.fee ?? 0), 0);
  await db.insert(s.auditLog).values({
    orgId: brand.orgId,
    brandId,
    actorType: "staff",
    actorId: admin.email,
    actorName: `${admin.name} (Corva)`,
    action: "collections.paid_out",
    target: brand.name,
    meta: { payments: settled.length, owedPaise: owed, reference: ref },
  });
  revalidatePath("/admin", "layout");
}
