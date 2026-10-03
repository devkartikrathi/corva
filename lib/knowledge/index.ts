import { eq, sql } from "drizzle-orm";
import { embedDocuments } from "@/lib/agent/retrieval";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Turning a document into something the agent can retrieve.
 *
 * Not a server action module on purpose: these are called by actions (the
 * Knowledge screen) and by onboarding, and anything exported from a
 * "use server" file is a public endpoint.
 */

/**
 * Split a document into retrievable pieces.
 *
 * Paragraphs, because that is how policies are written and how they are
 * quoted back — a fixed token window would cut "the agent may apply up to
 * ₹5,000" away from the condition that qualifies it.
 */
export function chunk(body: string): { anchor: string | null; content: string }[] {
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
export async function reindex(documentId: string, brandId: string, body: string) {
  return writeChunks(documentId, brandId, chunk(body));
}

/**
 * Replace a document's chunks with these pieces, embedded.
 *
 * Embedding is what costs time here, so it happens once for the whole document
 * rather than per chunk. If it throws, the chunks are stored without vectors —
 * an empty document retrieves nothing, while a half-updated one retrieves the
 * wrong thing and says nothing is wrong.
 *
 * `reuse` keeps the vector of any piece whose text has not changed, which is
 * what lets a catalog of hundreds of items be re-written on every edit without
 * embedding hundreds of lines each time. Off for documents, so the Re-index
 * button still means "embed this again".
 *
 * The delete and the insert run as one transaction behind a per-document lock,
 * so two saves landing together cannot leave both sets of chunks behind.
 */
export async function writeChunks(
  documentId: string,
  brandId: string,
  pieces: { anchor: string | null; content: string }[],
  { reuse = false }: { reuse?: boolean } = {},
) {
  const known = new Map<string, number[]>();
  if (reuse && pieces.length > 0) {
    const existing = await db
      .select({ content: s.documentChunks.content, embedding: s.documentChunks.embedding })
      .from(s.documentChunks)
      .where(eq(s.documentChunks.documentId, documentId));
    for (const c of existing) if (c.embedding) known.set(c.content, c.embedding);
  }

  // Without vectors the chunks are still stored: retrieval falls back to
  // matching words (see `retrieve`), and `npm run db:embed` fills them in
  // later. A business whose knowledge silently vanished because the embedding
  // quota ran out during onboarding would be worse than a slightly dumber one.
  const fresh = [...new Set(pieces.map((p) => p.content).filter((c) => !known.has(c)))];
  if (fresh.length > 0) {
    try {
      const vectors = await embedDocuments(fresh);
      fresh.forEach((content, i) => known.set(content, vectors[i]));
    } catch (e) {
      console.error("embedding failed, storing chunks unembedded:", (e as Error).message);
    }
  }

  const lock = db.execute(sql`select pg_advisory_xact_lock(hashtext(${documentId}))`);
  const clear = db.delete(s.documentChunks).where(eq(s.documentChunks.documentId, documentId));
  if (pieces.length === 0) {
    await db.batch([lock, clear]);
    return 0;
  }
  await db.batch([
    lock,
    clear,
    db.insert(s.documentChunks).values(
      pieces.map((p, i) => ({
        documentId,
        brandId,
        ordinal: i,
        anchor: p.anchor,
        content: p.content,
        embedding: known.get(p.content) ?? null,
      })),
    ),
  ]);
  return pieces.length;
}
