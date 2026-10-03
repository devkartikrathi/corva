"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { syncCatalog } from "@/lib/catalog";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";

/**
 * Products & services actions.
 *
 * Editing the catalog is editing what the AI quotes, so it takes the same
 * permission as publishing a document, and every write ends by rewriting the
 * catalog's knowledge document — an item saved here is in the next answer.
 */

export type GroupInput = { id?: string; parentId: string | null; name: string; description: string };
export type ItemInput = {
  id?: string;
  categoryId: string | null;
  kind: "service" | "product";
  name: string;
  /** Rupees as typed — "150", "99.50" — or empty for "price on request". */
  price: string;
  priceUnit: string;
  description: string;
  available: boolean;
};

async function context() {
  const ctx = await getConsoleContext();
  assertCan(ctx.session.actor, "documents.publish", { brandId: ctx.brand.id });
  return ctx;
}

async function done(ctx: Awaited<ReturnType<typeof context>>, action: string, target: string) {
  await syncCatalog(ctx.brand.id, ctx.brand.name, ctx.session.name);
  await audit({
    orgId: ctx.session.orgId,
    brandId: ctx.brand.id,
    actorId: ctx.session.membershipId,
    actorName: ctx.session.name,
    action,
    target,
  });
  revalidatePath("/app/catalog");
  revalidatePath("/app/knowledge");
}

async function group(id: string, brandId: string) {
  const [row] = await db
    .select()
    .from(s.catalogCategories)
    .where(and(eq(s.catalogCategories.id, id), eq(s.catalogCategories.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("No such group in this business.");
  return row;
}

async function item(id: string, brandId: string) {
  const [row] = await db
    .select()
    .from(s.catalogItems)
    .where(and(eq(s.catalogItems.id, id), eq(s.catalogItems.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("No such item in this business.");
  return row;
}

const text = (value: string, max: number, what: string) => {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${what} can be at most ${max} characters.`);
  return trimmed;
};

/** "₹1,250.50" or "1250.5" → 125050 paise; empty → null. */
function paise(price: string): number | null {
  const cleaned = price.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error("Price must be a number of rupees, like 150 or 99.50.");
  const value = Math.round(Number(cleaned) * 100);
  if (value > 2_000_000_000) throw new Error("That price is too large.");
  return value;
}

/** The next position among siblings, so a new row lands at the end. */
async function nextPosition(table: typeof s.catalogCategories | typeof s.catalogItems, where: ReturnType<typeof and>) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${table.position}), -1)::int + 1` })
    .from(table)
    .where(where);
  return row.n;
}

const siblingGroups = (brandId: string, parentId: string | null) =>
  and(
    eq(s.catalogCategories.brandId, brandId),
    parentId ? eq(s.catalogCategories.parentId, parentId) : isNull(s.catalogCategories.parentId),
  );
const siblingItems = (brandId: string, categoryId: string | null) =>
  and(
    eq(s.catalogItems.brandId, brandId),
    categoryId ? eq(s.catalogItems.categoryId, categoryId) : isNull(s.catalogItems.categoryId),
  );

export async function saveGroup(input: GroupInput) {
  const ctx = await context();
  const brandId = ctx.brand.id;
  const name = text(input.name, 120, "A group name");
  if (!name) throw new Error("A group needs a name.");
  const description = text(input.description, 2000, "A group description") || null;

  const parentId = input.parentId || null;
  if (parentId) {
    await group(parentId, brandId);
    // A group cannot be moved inside itself or anything under it.
    if (input.id) {
      const all = await db
        .select({ id: s.catalogCategories.id, parentId: s.catalogCategories.parentId })
        .from(s.catalogCategories)
        .where(eq(s.catalogCategories.brandId, brandId));
      const parents = new Map(all.map((g) => [g.id, g.parentId]));
      for (let at: string | null = parentId; at; at = parents.get(at) ?? null) {
        if (at === input.id) throw new Error("A group cannot go inside itself.");
      }
    }
  }

  if (input.id) {
    const existing = await group(input.id, brandId);
    const moved = existing.parentId !== parentId;
    await db
      .update(s.catalogCategories)
      .set({
        name,
        description,
        parentId,
        ...(moved ? { position: await nextPosition(s.catalogCategories, siblingGroups(brandId, parentId)) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.catalogCategories.id, input.id));
  } else {
    await db.insert(s.catalogCategories).values({
      brandId,
      parentId,
      name,
      description,
      position: await nextPosition(s.catalogCategories, siblingGroups(brandId, parentId)),
    });
  }
  await done(ctx, input.id ? "catalog.group_updated" : "catalog.group_added", name);
}

/** Deletes the group with every group and item inside it. */
export async function deleteGroup(id: string) {
  const ctx = await context();
  const row = await group(id, ctx.brand.id);
  await db.delete(s.catalogCategories).where(eq(s.catalogCategories.id, id));
  await done(ctx, "catalog.group_deleted", row.name);
}

export async function saveItem(input: ItemInput) {
  const ctx = await context();
  const brandId = ctx.brand.id;
  const name = text(input.name, 160, "An item name");
  if (!name) throw new Error("An item needs a name.");
  const categoryId = input.categoryId || null;
  if (categoryId) await group(categoryId, brandId);

  const values = {
    name,
    categoryId,
    kind: input.kind === "product" ? "product" : "service",
    pricePaise: paise(input.price),
    priceUnit: text(input.priceUnit, 40, "The price unit") || null,
    description: text(input.description, 4000, "A description") || null,
    available: input.available,
  };

  if (input.id) {
    const existing = await item(input.id, brandId);
    const moved = existing.categoryId !== categoryId;
    await db
      .update(s.catalogItems)
      .set({
        ...values,
        ...(moved ? { position: await nextPosition(s.catalogItems, siblingItems(brandId, categoryId)) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.catalogItems.id, input.id));
  } else {
    await db.insert(s.catalogItems).values({
      brandId,
      ...values,
      position: await nextPosition(s.catalogItems, siblingItems(brandId, categoryId)),
    });
  }
  await done(ctx, input.id ? "catalog.item_updated" : "catalog.item_added", name);
}

export async function setItemAvailable(id: string, available: boolean) {
  const ctx = await context();
  const row = await item(id, ctx.brand.id);
  await db.update(s.catalogItems).set({ available, updatedAt: new Date() }).where(eq(s.catalogItems.id, id));
  await done(ctx, available ? "catalog.item_available" : "catalog.item_unavailable", row.name);
}

export async function deleteItem(id: string) {
  const ctx = await context();
  const row = await item(id, ctx.brand.id);
  await db.delete(s.catalogItems).where(eq(s.catalogItems.id, id));
  await done(ctx, "catalog.item_deleted", row.name);
}

/**
 * Move a group or an item one place up or down among its siblings.
 *
 * Renumbers the whole sibling list rather than swapping two positions, so
 * rows that were created with equal positions still end up in a clean order.
 */
export async function move(kind: "group" | "item", id: string, by: -1 | 1) {
  const ctx = await context();
  const brandId = ctx.brand.id;

  const siblings =
    kind === "group"
      ? await db
          .select({ id: s.catalogCategories.id, position: s.catalogCategories.position, createdAt: s.catalogCategories.createdAt })
          .from(s.catalogCategories)
          .where(siblingGroups(brandId, (await group(id, brandId)).parentId))
      : await db
          .select({ id: s.catalogItems.id, position: s.catalogItems.position, createdAt: s.catalogItems.createdAt })
          .from(s.catalogItems)
          .where(siblingItems(brandId, (await item(id, brandId)).categoryId));

  siblings.sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
  const from = siblings.findIndex((r) => r.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= siblings.length) return;
  const [moved] = siblings.splice(from, 1);
  siblings.splice(to, 0, moved);

  const table = kind === "group" ? s.catalogCategories : s.catalogItems;
  await Promise.all(
    siblings.map((r, position) => db.update(table).set({ position }).where(eq(table.id, r.id))),
  );
  await done(ctx, "catalog.reordered", kind);
}
