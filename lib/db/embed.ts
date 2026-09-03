/**
 * Embeds every document chunk that does not yet have a vector.
 *
 * Safe to re-run: it only touches rows where `embedding IS NULL`, so adding a
 * document and re-running costs one call for the new chunks.
 */
import "./script-env";
import { eq, isNull, sql } from "drizzle-orm";
import { embedDocuments } from "@/lib/agent/retrieval";
import { db } from "./index";
import * as s from "./schema";

const BATCH = 50;

async function main() {
  const pending = await db
    .select({ id: s.documentChunks.id, content: s.documentChunks.content })
    .from(s.documentChunks)
    .where(isNull(s.documentChunks.embedding));

  if (pending.length === 0) {
    console.log("Nothing to embed — every chunk already has a vector.");
    return;
  }

  console.log(`Embedding ${pending.length} chunks…`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const vectors = await embedDocuments(batch.map((c) => c.content));

    await Promise.all(
      batch.map((chunk, j) =>
        db
          .update(s.documentChunks)
          .set({ embedding: vectors[j] })
          .where(eq(s.documentChunks.id, chunk.id)),
      ),
    );
    console.log(`  ${Math.min(i + BATCH, pending.length)} / ${pending.length}`);
  }

  // An IVFFlat index only pays off once there are vectors to organise.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.documentChunks);
  if (count >= 1000) {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
          ON document_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)`,
    );
    console.log("Created the IVFFlat index.");
  }

  console.log("Done.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
