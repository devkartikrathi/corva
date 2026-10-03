import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { writeChunks } from "@/lib/knowledge";
import { formatRupees } from "@/lib/money";

/**
 * Products & services: what a business sells, as the AI sees it.
 *
 * Kept as structured rows — groups that nest to any depth, items inside them —
 * because that is how a business thinks about its price list and how it edits
 * one. The AI reaches it two ways, and neither is a separate path to maintain:
 *
 *   1. An outline in the system prompt (`catalogOutline`), so "what do you do?"
 *      is answered from the whole list rather than from whichever five lines
 *      retrieval happened to rank first.
 *   2. A published knowledge document written from the rows (`syncCatalog`),
 *      one chunk per item and one per group. Chat, calls, email and WhatsApp
 *      all retrieve from the knowledge base already, so the catalog is
 *      searchable, citable and counted on every channel without any of them
 *      knowing it exists.
 *
 * The document is read-only on the Knowledge screen; the rows are the truth
 * and the document is rewritten from them on every edit.
 *
 * Not a server action module on purpose: anything exported from a "use server"
 * file is a public endpoint.
 */

/** `documents.source_system` of the document written from the catalog. */
export const CATALOG_SOURCE = "corva:catalog";
export const CATALOG_TITLE = "Products & services";

export type CatalogItem = typeof s.catalogItems.$inferSelect;
export type CatalogGroup = typeof s.catalogCategories.$inferSelect & {
  /** Names from the top group down to this one. */
  path: string[];
  items: CatalogItem[];
  children: CatalogGroup[];
};
export type Catalog = {
  groups: CatalogGroup[];
  /** Items that sit outside any group. */
  loose: CatalogItem[];
  itemCount: number;
  groupCount: number;
};

const byPosition = <T extends { position: number; createdAt: Date }>(a: T, b: T) =>
  a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();

/** The whole catalog of one brand, as a tree. */
export async function loadCatalog(brandId: string): Promise<Catalog> {
  const [groups, items] = await Promise.all([
    db.select().from(s.catalogCategories).where(eq(s.catalogCategories.brandId, brandId)),
    db.select().from(s.catalogItems).where(eq(s.catalogItems.brandId, brandId)),
  ]);

  const nodes = new Map<string, CatalogGroup>(groups.map((g) => [g.id, { ...g, path: [], items: [], children: [] }]));
  const roots: CatalogGroup[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const loose: CatalogItem[] = [];
  for (const item of items) {
    const group = item.categoryId ? nodes.get(item.categoryId) : undefined;
    (group ? group.items : loose).push(item);
  }

  const order = (list: CatalogGroup[], above: string[]) => {
    list.sort(byPosition);
    for (const g of list) {
      g.path = [...above, g.name];
      g.items.sort(byPosition);
      order(g.children, g.path);
    }
  };
  order(roots, []);
  loose.sort(byPosition);

  return { groups: roots, loose, itemCount: items.length, groupCount: groups.length };
}

/** Every group, depth first, in display order. */
export function flatten(groups: CatalogGroup[]): CatalogGroup[] {
  return groups.flatMap((g) => [g, ...flatten(g.children)]);
}

/** "₹150 per piece", "₹99 per kg", "Free", or "Price on request". */
export function priceText(item: Pick<CatalogItem, "pricePaise" | "priceUnit">): string {
  if (item.pricePaise === null) return "Price on request";
  const amount = item.pricePaise === 0 ? "Free" : formatRupees(item.pricePaise, { decimals: "auto" });
  return item.priceUnit ? `${amount} ${item.priceUnit}` : amount;
}

const oneLine = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const unavailable = (item: CatalogItem) => (item.available ? "" : " (not available right now)");

/**
 * The catalog as an indented list for the system prompt.
 *
 * Has to fit beside everything else the prompt carries, so it degrades rather
 * than truncates: with short descriptions while that fits, then names and
 * prices only, then just the groups. Whatever is left out is still one search
 * away in the knowledge base, which holds every line in full.
 */
export function catalogOutline(catalog: Catalog, budget = 6000): string | null {
  if (catalog.itemCount === 0 && catalog.groupCount === 0) return null;

  const render = (detail: "full" | "prices" | "groups") => {
    const lines: string[] = [];
    const item = (i: CatalogItem, indent: string) => {
      if (detail === "groups") return;
      const about = detail === "full" ? oneLine(i.description) : "";
      lines.push(`${indent}- ${i.name}: ${priceText(i)}${unavailable(i)}${about ? ` — ${clip(about, 110)}` : ""}`);
    };
    const group = (g: CatalogGroup, indent: string) => {
      const about = detail === "full" ? oneLine(g.description) : "";
      const count = detail === "groups" ? ` (${countItems(g)} item${countItems(g) === 1 ? "" : "s"})` : "";
      lines.push(`${indent}- ${g.name}${count}${about ? ` — ${clip(about, 110)}` : ""}`);
      for (const i of g.items) item(i, `${indent}  `);
      for (const c of g.children) group(c, `${indent}  `);
    };
    for (const g of catalog.groups) group(g, "");
    for (const i of catalog.loose) item(i, "");
    return lines.join("\n");
  };

  for (const detail of ["full", "prices", "groups"] as const) {
    const text = render(detail);
    if (text.length <= budget) return text;
  }
  return clip(render("groups"), budget);
}

function countItems(g: CatalogGroup): number {
  return g.items.length + g.children.reduce((n, c) => n + countItems(c), 0);
}

/**
 * The catalog as retrievable pieces.
 *
 * One per item, carrying its full description and the groups it sits in, so
 * "how much to dry clean a suit" lands on the suit. One per group, listing
 * what is in it with prices, so "what are your dry cleaning rates" lands on
 * the whole list. And one overview, for "what do you offer".
 */
export function catalogPieces(catalog: Catalog, brandName: string): { anchor: string; content: string }[] {
  const pieces: { anchor: string; content: string }[] = [];
  const all = flatten(catalog.groups);

  const top = [
    ...catalog.groups.map((g) => (g.children.length ? `${g.name} (${g.children.map((c) => c.name).join(", ")})` : g.name)),
    ...catalog.loose.map((i) => i.name),
  ];
  if (top.length) {
    pieces.push({ anchor: "Overview", content: `What ${brandName} offers: ${top.join("; ")}.` });
  }

  for (const g of all) {
    const about = oneLine(g.description);
    const listed = g.items.map((i) => `${i.name} — ${priceText(i)}${unavailable(i)}`);
    const sub = g.children.map((c) => c.name);
    const parts = [
      about,
      listed.length ? `Prices: ${listed.join("; ")}.` : "",
      sub.length ? `Includes: ${sub.join(", ")}.` : "",
    ].filter(Boolean);
    if (parts.length) pieces.push({ anchor: clip(g.path.join(" › "), 80), content: `${g.path.join(" › ")}: ${parts.join(" ")}` });
  }

  const describe = (i: CatalogItem, path: string[]) => {
    const where = path.length ? ` (${path.join(" › ")})` : "";
    const about = (i.description ?? "").trim();
    pieces.push({
      anchor: clip(i.name, 80),
      content: `${i.name}${where} — ${i.kind}, ${priceText(i)}${unavailable(i)}.${about ? ` ${about}` : ""}`,
    });
  };
  for (const g of all) for (const i of g.items) describe(i, g.path);
  for (const i of catalog.loose) describe(i, []);

  return pieces;
}

/** The document written from the catalog, if this brand has one. */
export async function catalogDocument(brandId: string) {
  const [doc] = await db
    .select()
    .from(s.documents)
    .where(and(eq(s.documents.brandId, brandId), eq(s.documents.sourceSystem, CATALOG_SOURCE)))
    .orderBy(asc(s.documents.createdAt))
    .limit(1);
  return doc ?? null;
}

/**
 * Rewrite the catalog's knowledge document from the rows.
 *
 * Called after every catalog edit. Reads, embeds what changed, writes — and
 * then reads again: a second edit that landed while this one was embedding
 * would otherwise be overwritten by an older picture of the catalog, and the
 * AI would quote a price the screen says was changed. The loop ends as soon
 * as what was written matches what is there.
 */
export async function syncCatalog(brandId: string, brandName: string, by: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const catalog = await loadCatalog(brandId);
    const pieces = catalogPieces(catalog, brandName);
    const body = pieces.map((p) => p.content).join("\n\n");

    let doc = await catalogDocument(brandId);
    if (!doc && pieces.length === 0) return;
    if (!doc) {
      [doc] = await db
        .insert(s.documents)
        .values({
          brandId,
          title: CATALOG_TITLE,
          collection: "Catalog",
          kind: "Reference",
          body,
          status: "published",
          sourceSystem: CATALOG_SOURCE,
          ownerName: by,
          updatedByName: by,
        })
        .returning();
      await db.insert(s.documentRevisions).values({
        documentId: doc.id,
        revision: 1,
        title: doc.title,
        body,
        note: "Written from Products & services",
        authorName: by,
      });
    } else if (doc.body !== body) {
      const revision = doc.revision + 1;
      await db
        .update(s.documents)
        .set({
          body,
          revision,
          // An emptied catalog takes itself out of retrieval; a filled one puts itself back.
          status: pieces.length ? "published" : "archived",
          updatedByName: by,
          updatedAt: new Date(),
        })
        .where(eq(s.documents.id, doc.id));
      await db.insert(s.documentRevisions).values({
        documentId: doc.id,
        revision,
        title: doc.title,
        body,
        note: "Updated from Products & services",
        authorName: by,
      });
    }

    await writeChunks(doc.id, brandId, pieces, { reuse: true });

    const now = catalogPieces(await loadCatalog(brandId), brandName);
    if (now.map((p) => p.content).join("\n\n") === body) return;
  }
}
