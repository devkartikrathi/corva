"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { isKnownModel, resolveModel } from "@/lib/agent/models";
import { formatPhone, isPlausiblePhone, numberTaken } from "@/lib/business/phone";

/**
 * What Corva staff can do to a business.
 *
 * Each change is written to that business's own audit log, so the owner can
 * see what staff did without asking.
 */

async function brandIn(orgSlug: string, brandId: string) {
  const [brand] = await db
    .select({ id: s.brands.id, name: s.brands.name, orgId: s.brands.orgId, modelId: s.brands.modelId })
    .from(s.brands)
    .innerJoin(s.organizations, eq(s.organizations.id, s.brands.orgId))
    .where(and(eq(s.brands.id, brandId), eq(s.organizations.slug, orgSlug)))
    .limit(1);
  if (!brand) throw new Error("No such business.");
  return brand;
}

/**
 * Change which model a business answers on.
 *
 * Ours to choose rather than theirs: the free tier meters requests per model
 * per day across the whole key, so this is as much about what we can afford
 * to give them today as about quality.
 */
export async function setBrandModel(orgSlug: string, brandId: string, modelId: string) {
  const { staff } = await requireStaff();
  if (!isKnownModel(modelId)) throw new Error("That is not a model we offer.");

  const brand = await brandIn(orgSlug, brandId);
  if (brand.modelId === modelId) return;

  await db.update(s.brands).set({ modelId }).where(eq(s.brands.id, brand.id));
  await db.insert(s.auditLog).values({
    orgId: brand.orgId,
    brandId: brand.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "brand.model_changed",
    target: brand.name,
    meta: { from: resolveModel(brand.modelId).label, to: resolveModel(modelId).label },
  });
  revalidatePath(`/operator/companies/${orgSlug}`);
}

/** Give a business a different number. Refused if another business has it. */
export async function setBusinessNumber(orgSlug: string, brandId: string, number: string) {
  const { staff } = await requireStaff();
  const brand = await brandIn(orgSlug, brandId);
  if (!isPlausiblePhone(number)) throw new Error("That phone number does not look right.");
  const clash = await numberTaken(number, brand.id);
  if (clash) throw new Error(`${formatPhone(number)} is already ${clash}'s number.`);

  const formatted = formatPhone(number);
  await db
    .insert(s.channels)
    .values({ brandId: brand.id, kind: "phone", address: formatted, detail: formatted, state: "live" })
    .onConflictDoUpdate({
      target: [s.channels.brandId, s.channels.kind],
      set: { address: formatted, detail: formatted, state: "live" },
    });
  await db.insert(s.auditLog).values({
    orgId: brand.orgId,
    brandId: brand.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "channel.number_changed",
    target: formatted,
  });
  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${orgSlug}`);
}

/**
 * Remove a business and everything in it.
 *
 * For the test businesses a demo leaves behind. Everything cascades —
 * conversations, customers, leads, people — so the screen asks first, and the
 * name has to be typed back to confirm it is the one meant.
 */
export async function removeBusiness(orgSlug: string, confirmName: string) {
  await requireStaff();
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, orgSlug)).limit(1);
  if (!org) throw new Error("No such business.");
  if (confirmName.trim().toLowerCase() !== org.name.trim().toLowerCase()) {
    throw new Error(`Type "${org.name}" to confirm.`);
  }
  await db.delete(s.organizations).where(eq(s.organizations.id, org.id));
  revalidatePath("/operator");
  redirect("/operator");
}
