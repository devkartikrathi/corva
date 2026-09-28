import { embed, embedMany } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MIN_RETRIEVAL_CONFIDENCE } from "./model";

/**
 * Retrieval over a brand's knowledge base.
 *
 * The whole product rests on one rule: the AI answers only from documents the
 * tenant published, and every answer records which chunk it used. So this
 * module returns confidences, not just text, and the caller is expected to
 * refuse rather than improvise when nothing clears the bar.
 */

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  anchor: string | null;
  content: string;
  /** Cosine similarity, 0–1. */
  confidence: number;
};

/**
 * Re-normalise a truncated embedding to unit length.
 *
 * Gemini's reduced dimensions are Matryoshka truncations of the 3072-wide
 * vector, so they are no longer unit-length. pgvector's cosine operator
 * tolerates that, but similarities drift and the confidence threshold stops
 * meaning what it says — so this is not optional.
 */
function normalise(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  // A zero vector cannot be normalised; return it rather than divide by zero.
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** Fail loudly rather than write a vector the column cannot hold. */
function assertWidth(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding is ${vector.length}-dimensional, expected ${EMBEDDING_DIMENSIONS}. ` +
        `The provider ignored outputDimensionality — check the model is instantiated ` +
        `directly rather than routed through a gateway.`,
    );
  }
  return vector;
}

/**
 * Embed a customer's question.
 *
 * `RETRIEVAL_QUERY` and `RETRIEVAL_DOCUMENT` are two halves of one asymmetric
 * space: a short question and a long policy paragraph are embedded
 * differently on purpose so they land near each other.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_QUERY" },
    },
  });
  return normalise(assertWidth(embedding));
}

/** Embed document chunks for indexing. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: texts,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_DOCUMENT" },
    },
  });
  return embeddings.map((e) => normalise(assertWidth(e)));
}

/**
 * Nearest chunks within one brand.
 *
 * Brand scoping happens in the WHERE clause, not after ranking — a tenant's
 * documents must never be reachable from another tenant's conversation, and
 * that guarantee should not depend on a post-filter.
 */
export async function retrieve(
  brandId: string,
  query: string,
  limit = 5,
): Promise<RetrievedChunk[]> {
  try {
    const embedding = await embedQuery(query);
    const vector = sql.raw(`'[${embedding.join(",")}]'::vector`);

    const rows = await db
      .select({
        chunkId: s.documentChunks.id,
        documentId: s.documents.id,
        documentTitle: s.documents.title,
        anchor: s.documentChunks.anchor,
        content: s.documentChunks.content,
        // pgvector's <=> is cosine distance; similarity is its complement.
        confidence: sql<number>`1 - (${s.documentChunks.embedding} <=> ${vector})`,
      })
      .from(s.documentChunks)
      .innerJoin(s.documents, eq(s.documents.id, s.documentChunks.documentId))
      .where(
        and(
          eq(s.documentChunks.brandId, brandId),
          eq(s.documents.status, "published"),
          sql`${s.documentChunks.embedding} IS NOT NULL`,
        ),
      )
      .orderBy(sql`${s.documentChunks.embedding} <=> ${vector}`)
      .limit(limit);

    if (rows.length > 0) return rows.map((r) => ({ ...r, confidence: Number(r.confidence) }));
  } catch (e) {
    console.error("vector retrieval failed, matching words instead:", (e as Error).message);
  }
  return retrieveByWords(brandId, query, limit);
}

/** Words that say nothing about what the caller wants. */
const STOPWORDS = new Set(
  (
    "a an and are as at be but by can could do does for from have how i if in is it me my of on or our " +
    "please the their there this to was we what when where which who why will with you your hi hello " +
    "want need know tell about any get like would"
  ).split(" "),
);

const terms = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * Retrieval without embeddings.
 *
 * The fallback for when the embedding API is unavailable or a brand's chunks
 * were stored before it came back. Scores are the share of the question's
 * meaningful words that appear in the chunk, mapped onto the same 0–1 scale so
 * the confidence bar still means "enough of this is about that". Crude, but a
 * new business's knowledge base is a few dozen paragraphs, and a crude answer
 * from the right paragraph beats a confident escalation from none.
 */
async function retrieveByWords(brandId: string, query: string, limit: number): Promise<RetrievedChunk[]> {
  const wanted = [...new Set(terms(query))];
  if (wanted.length === 0) return [];

  const rows = await db
    .select({
      chunkId: s.documentChunks.id,
      documentId: s.documents.id,
      documentTitle: s.documents.title,
      anchor: s.documentChunks.anchor,
      content: s.documentChunks.content,
    })
    .from(s.documentChunks)
    .innerJoin(s.documents, eq(s.documents.id, s.documentChunks.documentId))
    .where(and(eq(s.documentChunks.brandId, brandId), eq(s.documents.status, "published")))
    .limit(1000);

  return rows
    .map((r) => {
      const have = new Set(terms(`${r.documentTitle} ${r.anchor ?? ""} ${r.content}`));
      const hits = wanted.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) || w.startsWith(h))).length;
      const share = hits / wanted.length;
      return { ...r, confidence: hits === 0 ? 0 : Math.min(0.95, 0.45 + share * 0.5) };
    })
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** Whether anything retrieved is good enough to answer from. */
export function hasGrounding(chunks: RetrievedChunk[]): boolean {
  return chunks.some((c) => c.confidence >= MIN_RETRIEVAL_CONFIDENCE);
}

/** Only the chunks that clear the bar, best first. */
export function grounded(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks.filter((c) => c.confidence >= MIN_RETRIEVAL_CONFIDENCE);
}

/**
 * Record that the AI could not answer an intent. These rows are what the
 * Knowledge screen ranks as gaps and the Analytics screen prices.
 */
export async function recordGap(brandId: string, intent: string, reason = "no_document") {
  await db
    .insert(s.knowledgeGaps)
    .values({ brandId, intent, reason, hits: 1 })
    .onConflictDoUpdate({
      target: [s.knowledgeGaps.brandId, s.knowledgeGaps.intent],
      set: {
        hits: sql`${s.knowledgeGaps.hits} + 1`,
        lastSeenAt: new Date(),
      },
    });
}
