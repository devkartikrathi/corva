"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { embedDocuments } from "@/lib/agent/retrieval";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan, can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";

/**
 * Knowledge base actions.
 *
 * The rule that makes the whole product work is that the AI answers only from
 * these documents — which means editing one is editing what the agent will
 * say. So every write here re-chunks and re-embeds in the same transaction of
 * work: a document whose text has changed but whose vectors have not is worse
 * than no document, because the screen says it is published while retrieval
 * still returns the old paragraph.
 */

async function scoped(documentId: string, brandId: string) {
  const [row] = await db
    .select()
    .from(s.documents)
    .where(and(eq(s.documents.id, documentId), eq(s.documents.brandId, brandId)))
    .limit(1);
  if (!row) throw new Error("No such document in this brand.");
  return row;
}

/**
 * Split a document into retrievable pieces.
 *
 * Paragraphs, because that is how policies are written and how they are
 * quoted back — a fixed token window would cut "the agent may apply up to
 * £50" away from the condition that qualifies it.
 */
function chunk(body: string): { anchor: string | null; content: string }[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((content, i) => {
    // A leading "§3.2" or "Reschedules:" becomes the anchor a citation prints.
    const match = content.match(/^(§[\d.]+|[A-Z][A-Za-z \-&]{2,28})[:—-]\s/);
    return {
      anchor: match ? match[1].trim() : `¶${i + 1}`,
      content,
    };
  });
}

/**
 * Rewrite a document's chunks and embed them.
 *
 * Embedding is what costs time here, so it happens once for the whole document
 * rather than per chunk. If it throws, the old chunks are already gone — which
 * is the right failure: an empty document retrieves nothing, while a
 * half-updated one retrieves the wrong thing and says nothing is wrong.
 */
async function reindex(documentId: string, brandId: string, body: string) {
  await db.delete(s.documentChunks).where(eq(s.documentChunks.documentId, documentId));

  const pieces = chunk(body);
  if (pieces.length === 0) return 0;

  const vectors = await embedDocuments(pieces.map((p) => p.content));
  await db.insert(s.documentChunks).values(
    pieces.map((p, i) => ({
      documentId,
      brandId,
      ordinal: i,
      anchor: p.anchor,
      content: p.content,
      embedding: vectors[i],
    })),
  );
  return pieces.length;
}

export async function createDocument(input: {
  title: string;
  collection: string;
  kind: string;
  body: string;
  publish: boolean;
}) {
  const { session, brand } = await getConsoleContext();
  const decision = can(session.actor, "documents.publish", { brandId: brand.id });
  if (!decision.allowed && decision.grant !== "draft") throw new Error(decision.reason);
  // An Agent may create, but never publish — so their document lands as a draft
  // whatever the form asked for.
  const publish = input.publish && decision.allowed;

  const title = input.title.trim();
  if (!title) throw new Error("A document needs a title.");

  const [doc] = await db
    .insert(s.documents)
    .values({
      brandId: brand.id,
      title,
      collection: input.collection.trim() || "Uncategorised",
      kind: input.kind.trim() || "Policy",
      body: input.body,
      status: publish ? "published" : "draft",
      ownerName: session.name,
      updatedByName: session.name,
      revision: 1,
    })
    .returning();

  await db.insert(s.documentRevisions).values({
    documentId: doc.id,
    revision: 1,
    title: doc.title,
    body: doc.body,
    note: publish ? "Created and published" : "Created as a draft",
    authorName: session.name,
  });

  // Only published documents are retrievable; a draft is deliberately invisible
  // to the agent until someone stands behind it.
  if (publish) await reindex(doc.id, brand.id, input.body);

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: publish ? "document.published" : "document.drafted",
    target: doc.title,
  });

  revalidatePath("/app/knowledge");
  return doc.id;
}

export async function updateDocument(
  documentId: string,
  input: { title: string; collection: string; kind: string; body: string; note?: string },
) {
  const { session, brand } = await getConsoleContext();
  const decision = can(session.actor, "documents.publish", { brandId: brand.id });
  if (!decision.allowed && decision.grant !== "draft") throw new Error(decision.reason);

  const existing = await scoped(documentId, brand.id);
  if (existing.status === "published" && !decision.allowed) {
    throw new Error("You can draft documents, but publishing a change needs a Manager.");
  }

  const title = input.title.trim();
  if (!title) throw new Error("A document needs a title.");

  const revision = existing.revision + 1;
  await db
    .update(s.documents)
    .set({
      title,
      collection: input.collection.trim() || "Uncategorised",
      kind: input.kind.trim() || "Policy",
      body: input.body,
      revision,
      updatedByName: session.name,
      updatedAt: new Date(),
    })
    .where(eq(s.documents.id, documentId));

  await db.insert(s.documentRevisions).values({
    documentId,
    revision,
    title,
    body: input.body,
    note: input.note?.trim() || null,
    authorName: session.name,
  });

  if (existing.status === "published") await reindex(documentId, brand.id, input.body);

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "document.updated",
    target: title,
    meta: { revision },
  });

  revalidatePath("/app/knowledge");
  revalidatePath(`/app/knowledge/${documentId}`);
}

/** Publish a draft, or take a published document back out of retrieval. */
export async function setDocumentStatus(documentId: string, status: "draft" | "published" | "archived") {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const doc = await scoped(documentId, brand.id);
  await db.update(s.documents).set({ status, updatedAt: new Date(), updatedByName: session.name }).where(eq(s.documents.id, documentId));

  if (status === "published") {
    await reindex(documentId, brand.id, doc.body);
  } else {
    // Unpublishing has to remove the vectors, or the agent keeps quoting a
    // document the console says is archived.
    await db.delete(s.documentChunks).where(eq(s.documentChunks.documentId, documentId));
  }

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: `document.${status}`,
    target: doc.title,
  });

  revalidatePath("/app/knowledge");
  revalidatePath(`/app/knowledge/${documentId}`);
}

/** Put an earlier revision back, as a new revision rather than by rewinding. */
export async function restoreRevision(documentId: string, revision: number) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const doc = await scoped(documentId, brand.id);
  const [old] = await db
    .select()
    .from(s.documentRevisions)
    .where(and(eq(s.documentRevisions.documentId, documentId), eq(s.documentRevisions.revision, revision)))
    .limit(1);
  if (!old) throw new Error("No such revision.");

  await updateDocument(documentId, {
    title: old.title,
    collection: doc.collection,
    kind: doc.kind,
    body: old.body,
    note: `Restored revision ${revision}`,
  });
}

/**
 * Re-embed everything a brand has published.
 *
 * The button behind "N of M chunks indexed". Rare, but the alternative when
 * embeddings drift is a shell script, and the person who notices the number is
 * not the person with a terminal.
 */
export async function reindexBrand() {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const docs = await db
    .select()
    .from(s.documents)
    .where(and(eq(s.documents.brandId, brand.id), eq(s.documents.status, "published")));

  let chunks = 0;
  for (const doc of docs) chunks += await reindex(doc.id, brand.id, doc.body);

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "knowledge.reindexed",
    target: brand.id,
    meta: { documents: docs.length, chunks },
  });

  revalidatePath("/app/knowledge");
  return { documents: docs.length, chunks };
}

/** Dismiss a gap someone has decided not to write a document for. */
export async function dismissGap(gapId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const [gap] = await db
    .select()
    .from(s.knowledgeGaps)
    .where(and(eq(s.knowledgeGaps.id, gapId), eq(s.knowledgeGaps.brandId, brand.id)))
    .limit(1);
  if (!gap) throw new Error("No such gap.");

  await db.delete(s.knowledgeGaps).where(eq(s.knowledgeGaps.id, gapId));
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "gap.dismissed",
    target: gap.intent,
    meta: { hits: gap.hits },
  });

  revalidatePath("/app/knowledge");
}

/** Trigger a sync on a connected source. */
export async function syncSource(sourceId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "documents.publish", { brandId: brand.id });

  const [source] = await db
    .select()
    .from(s.knowledgeSources)
    .where(and(eq(s.knowledgeSources.id, sourceId), eq(s.knowledgeSources.brandId, brand.id)))
    .limit(1);
  if (!source) throw new Error("No such source.");
  if (source.status === "error") {
    throw new Error(source.error ?? "This source needs reconnecting before it can sync.");
  }

  // The connectors themselves are outside this codebase; what is real here is
  // that the attempt is recorded and the screen stops claiming a stale time.
  const docCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.documents)
    .where(and(eq(s.documents.brandId, brand.id), eq(s.documents.sourceSystem, source.name)));

  await db
    .update(s.knowledgeSources)
    .set({ status: "synced", lastSyncedAt: new Date(), docCount: docCount[0].n, error: null })
    .where(eq(s.knowledgeSources.id, sourceId));

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "knowledge_source.synced",
    target: source.name,
  });

  revalidatePath("/app/knowledge");
}

/** One document with its revisions, for the editor. */
export async function getDocument(documentId: string) {
  const { brand } = await getConsoleContext();
  const doc = await scoped(documentId, brand.id);

  const [revisions, chunks, citations] = await Promise.all([
    db
      .select()
      .from(s.documentRevisions)
      .where(eq(s.documentRevisions.documentId, documentId))
      .orderBy(desc(s.documentRevisions.revision))
      .limit(20),
    db
      .select()
      .from(s.documentChunks)
      .where(eq(s.documentChunks.documentId, documentId))
      .orderBy(s.documentChunks.ordinal),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.turnCitations)
      .where(eq(s.turnCitations.documentId, documentId)),
  ]);

  return { document: doc, revisions, chunks, citationCount: citations[0].n };
}
