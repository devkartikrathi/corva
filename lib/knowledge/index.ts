import { eq } from "drizzle-orm";
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
  await db.delete(s.documentChunks).where(eq(s.documentChunks.documentId, documentId));

  const pieces = chunk(body);
  if (pieces.length === 0) return 0;

  // Without vectors the chunks are still stored: retrieval falls back to
  // matching words (see `retrieve`), and `npm run db:embed` fills them in
  // later. A business whose knowledge silently vanished because the embedding
  // quota ran out during onboarding would be worse than a slightly dumber one.
  let vectors: (number[] | null)[];
  try {
    vectors = await embedDocuments(pieces.map((p) => p.content));
  } catch (e) {
    console.error("embedding failed, storing chunks unembedded:", (e as Error).message);
    vectors = pieces.map(() => null);
  }
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
